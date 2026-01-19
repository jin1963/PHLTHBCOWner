import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

/* =========================
   CONFIG (HARDCODE)
========================= */
const CHAIN_ID_DEC = 56;
const CHAIN_ID_HEX = "0x38";

// ✅ YOUR ADDRESSES
const CONTRACT_ADDRESS = "0x15444214d8224874d5ED341a12D596073c32F0ed";
const THBC_ADDRESS     = "0xe8d4687b77B5611eF1828FDa7428034FA12a1Beb";
const PHL_ADDRESS      = "0xffeb0234a85a46F8Fdf6b8dEEFd2b4C7cB503df5";

// ✅ Pool เดียว
const POOL_ID = 0;

// ✅ จำกัด package ให้ตรง User DApp
const PACKAGE_MIN = 0;
const PACKAGE_MAX = 9;

// ✅ Owner whitelist (ใส่ owner จริงเพื่อกันคนอื่นกด)
const OWNER_WHITELIST = ""; 
// 👆 ใส่ได้ 2 แบบ:
// - ปล่อยว่าง "" = จะดึงจาก owner() แล้วใช้เป็น whitelist อัตโนมัติ (แนะนำ)
// - หรือใส่ address owner คงที่เอง

/* =========================
   ABI
========================= */
const CONTRACT_ABI = [
  {"inputs":[{"internalType":"address","name":"_thbc","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},
  {"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"poolCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"poolId","type":"uint256"},{"internalType":"uint256","name":"packageId","type":"uint256"},{"internalType":"uint256","name":"thbcIn","type":"uint256"},{"internalType":"uint256","name":"principalOut","type":"uint256"},{"internalType":"bool","name":"active","type":"bool"}],"name":"setPackage","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"poolId","type":"uint256"},{"internalType":"uint256","name":"packageId","type":"uint256"}],"name":"getPackage","outputs":[{"internalType":"uint256","name":"thbcIn","type":"uint256"},{"internalType":"uint256","name":"principalOut","type":"uint256"},{"internalType":"bool","name":"active","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"poolId","type":"uint256"}],"name":"getPool","outputs":[{"internalType":"address","name":"outToken","type":"address"},{"internalType":"uint256","name":"apyBP","type":"uint256"},{"internalType":"uint256","name":"lockSec","type":"uint256"},{"internalType":"bool","name":"enabled","type":"bool"},{"internalType":"uint256","name":"packageCount_","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"poolId","type":"uint256"},{"internalType":"uint256","name":"apyBP","type":"uint256"},{"internalType":"uint256","name":"lockSec","type":"uint256"},{"internalType":"bool","name":"enabled","type":"bool"}],"name":"setPoolParams","outputs":[],"stateMutability":"nonpayable","type":"function"}
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

/* =========================
   DOM helpers
========================= */
const $ = (id) => document.getElementById(id);

function setMsg(text, kind="muted") {
  const el = $("msg");
  if (!el) return;
  el.className = `msg ${kind}`;
  el.textContent = text;
}
function shortAddr(a){ return a ? `${a.slice(0,6)}...${a.slice(-4)}` : "-"; }

function disableActions(disabled) {
  $("btnScan").disabled = disabled;
  $("btnReloadOwner").disabled = disabled;
  $("btnReadPkg").disabled = disabled;
  $("btnSetPkg").disabled = disabled;
  $("btnReadPool").disabled = disabled;
  $("btnSetPool").disabled = disabled;
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

/* =========================
   Network / Provider picker
========================= */
async function ensureBSC(injected) {
  // บาง Bitget ไม่ให้ switch: เราจะพยายาม แต่ไม่ให้แอพพัง
  try {
    const cid = await injected.request({ method: "eth_chainId" });
    if (cid === CHAIN_ID_HEX) return;

    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (e) {
    // ถ้า add chain ได้ค่อย add
    if (e?.code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-dataseed.binance.org/"],
          blockExplorerUrls: ["https://bscscan.com/"],
        }],
      });
    } else {
      // ignore
    }
  }
}

async function pickInjectedProvider() {
  const eth = window.ethereum;

  if (eth?.providers?.length) {
    return (
      eth.providers.find(x => x.isBitgetWallet) ||
      eth.providers.find(x => x.isBitKeep) ||
      eth.providers.find(x => x.isMetaMask) ||
      eth.providers[0]
    );
  }

  if (window.bitgetWallet?.ethereum) return window.bitgetWallet.ethereum;
  if (window.bitkeep?.ethereum) return window.bitkeep.ethereum;
  if (window.BitKeep?.ethereum) return window.BitKeep.ethereum;
  if (eth) return eth;
  return null;
}

/* =========================
   State
========================= */
let provider, signer, user;
let contractRO, contractRW;
let thbcRO, phlRO;

let thbcDec = 18, phlDec = 18;
let thbcSym = "THBC", phlSym = "PHL";

let ownerOnChain = null;
let ownerAllowed = false;

/* =========================
   Read helpers
========================= */
async function readOwner() {
  ownerOnChain = await contractRO.owner();
  const whitelist = OWNER_WHITELIST?.trim();
  const allowedOwner = whitelist ? whitelist : ownerOnChain;

  ownerAllowed = (user?.toLowerCase() === allowedOwner.toLowerCase());

  const gate = $("ownerGate");
  if (ownerAllowed) {
    gate.textContent = `✅ Owner verified: ${shortAddr(user)}`;
    gate.className = "gate ok";
  } else {
    gate.textContent = `⛔ Not owner. Connected: ${shortAddr(user)} | Owner: ${shortAddr(allowedOwner)}`;
    gate.className = "gate bad";
  }

  disableActions(!ownerAllowed);
}

async function sanityPool() {
  const pc = Number(await contractRO.poolCount());
  if (pc <= POOL_ID) throw new Error(`Pool not exists (poolCount=${pc}, need poolId=${POOL_ID})`);
}

async function readPackage(packageId) {
  const [thbcIn, principalOut, active] = await contractRO.getPackage(POOL_ID, packageId);
  return { packageId, thbcIn, principalOut, active };
}

function fmtPkg(pkg) {
  return JSON.stringify({
    poolId: POOL_ID,
    packageId: pkg.packageId,
    thbcIn: `${ethers.formatUnits(pkg.thbcIn, thbcDec)} ${thbcSym}`,
    principalOut: `${ethers.formatUnits(pkg.principalOut, phlDec)} ${phlSym}`,
    active: pkg.active
  }, null, 2);
}

/* =========================
   Actions
========================= */
async function scanPackages() {
  await sanityPool();
  setMsg("กำลังสแกนแพ็คเกจ 0–9 ...", "warn");

  const lines = [];
  for (let i = PACKAGE_MIN; i <= PACKAGE_MAX; i++) {
    try {
      const p = await readPackage(i);
      lines.push(
        `#${i} | active=${p.active} | THBC=${ethers.formatUnits(p.thbcIn, thbcDec)} | PHL=${ethers.formatUnits(p.principalOut, phlDec)}`
      );
    } catch (e) {
      lines.push(`#${i} | (read failed) ${e?.message || e}`);
    }
  }

  $("pkgPreview").textContent = lines.join("\n");
  setMsg("สแกนเสร็จแล้ว ✅", "ok");
}

async function readSelectedPackage() {
  await sanityPool();
  const pid = clampInt($("packageId").value, PACKAGE_MIN, PACKAGE_MAX);
  $("packageId").value = String(pid);

  setMsg(`อ่าน getPackage #${pid} ...`, "warn");
  const p = await readPackage(pid);
  $("pkgPreview").textContent = fmtPkg(p);
  setMsg("อ่านข้อมูลแพ็คเกจแล้ว ✅", "ok");
}

async function sendSetPackage() {
  await sanityPool();

  const pid = clampInt($("packageId").value, PACKAGE_MIN, PACKAGE_MAX);
  $("packageId").value = String(pid);

  const active = $("active").checked;

  // รับเป็น human แล้ว parseUnits ตาม decimals
  const thbcHuman = $("thbcInHuman").value?.trim();
  const phlHuman  = $("phlOutHuman").value?.trim();

  if (!thbcHuman || !phlHuman) throw new Error("กรุณากรอก THBC/PHL เป็นตัวเลข");

  const thbcInWei = ethers.parseUnits(thbcHuman, thbcDec);
  const phlOutWei = ethers.parseUnits(phlHuman, phlDec);

  setMsg(`กำลังส่ง setPackage(poolId=${POOL_ID}, packageId=${pid}) ...`, "warn");

  const tx = await contractRW.setPackage(POOL_ID, pid, thbcInWei, phlOutWei, active);
  await tx.wait();

  setMsg("✅ setPackage สำเร็จ", "ok");
  await readSelectedPackage();
}

async function readPool() {
  await sanityPool();
  setMsg("อ่าน getPool(0) ...", "warn");
  const [outToken, apyBP, lockSec, enabled, packageCount_] = await contractRO.getPool(POOL_ID);
  $("poolPreview").textContent = JSON.stringify({
    poolId: POOL_ID,
    outToken,
    apyBP: String(apyBP),
    lockSec: String(lockSec),
    enabled,
    packageCount_: String(packageCount_)
  }, null, 2);
  setMsg("อ่าน pool แล้ว ✅", "ok");
}

async function sendSetPoolParams() {
  await sanityPool();

  const apyBP = clampInt($("apyBP").value, 0, 1000000);
  const lockSec = clampInt($("lockSec").value, 0, 10_000_000_000);
  const enabled = $("poolEnabled").checked;

  setMsg(`กำลังส่ง setPoolParams(poolId=${POOL_ID}) ...`, "warn");
  const tx = await contractRW.setPoolParams(POOL_ID, apyBP, lockSec, enabled);
  await tx.wait();

  setMsg("✅ setPoolParams สำเร็จ", "ok");
  await readPool();
}

/* =========================
   Connect
========================= */
async function connect() {
  try {
    const injected = await pickInjectedProvider();
    if (!injected) {
      setMsg("ไม่พบ Wallet provider (ให้เปิดผ่าน Bitget/MetaMask DApp Browser)", "bad");
      return;
    }

    setMsg("กำลังเชื่อมต่อ Owner Wallet ...", "warn");

    // ขอ account
    await injected.request({ method: "eth_requestAccounts" });

    // พยายาม switch BSC (ถ้าไม่ได้ก็ไม่พัง)
    await ensureBSC(injected);

    provider = new ethers.BrowserProvider(injected);
    signer = await provider.getSigner();
    user = await signer.getAddress();

    const net = await provider.getNetwork();
    $("walletStatus").textContent = `✅ ${shortAddr(user)}`;
    $("netStatus").textContent = `Network: ${Number(net.chainId)}`;
    $("netStatus").className = `pill ${Number(net.chainId) === CHAIN_ID_DEC ? "pillOk" : "pillBad"}`;

    contractRO = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    contractRW = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    thbcRO = new ethers.Contract(THBC_ADDRESS, ERC20_ABI, provider);
    phlRO  = new ethers.Contract(PHL_ADDRESS, ERC20_ABI, provider);

    [thbcDec, phlDec] = await Promise.all([thbcRO.decimals(), phlRO.decimals()]);
    [thbcSym, phlSym] = await Promise.all([thbcRO.symbol(), phlRO.symbol()]);

    $("contractAddr").textContent = CONTRACT_ADDRESS;
    $("tokenMeta").textContent = `THBC: ${THBC_ADDRESS} (${thbcSym}, dec=${thbcDec}) | PHL: ${PHL_ADDRESS} (${phlSym}, dec=${phlDec})`;

    // owner gate
    await readOwner();

    setMsg("เชื่อมต่อสำเร็จ ✅", "ok");
  } catch (e) {
    console.error(e);
    setMsg(`เชื่อมต่อไม่สำเร็จ: ${e?.message || e}`, "bad");
    disableActions(true);
  }
}

/* =========================
   UI Events
========================= */
$("btnConnect").addEventListener("click", connect);

$("btnReloadOwner").addEventListener("click", async () => {
  try {
    setMsg("กำลังโหลด owner() ...", "warn");
    await readOwner();
    setMsg("อัปเดต owner แล้ว", "ok");
  } catch (e) {
    console.error(e);
    setMsg(`โหลด owner ไม่สำเร็จ: ${e?.message || e}`, "bad");
  }
});

$("btnScan").addEventListener("click", async () => {
  try { await scanPackages(); }
  catch (e) { console.error(e); setMsg(`Scan ไม่สำเร็จ: ${e?.message || e}`, "bad"); }
});

$("btnReadPkg").addEventListener("click", async () => {
  try { await readSelectedPackage(); }
  catch (e) { console.error(e); setMsg(`Read package ไม่สำเร็จ: ${e?.message || e}`, "bad"); }
});

$("btnSetPkg").addEventListener("click", async () => {
  try {
    $("btnSetPkg").disabled = true;
    await sendSetPackage();
  } catch (e) {
    console.error(e);
    setMsg(`setPackage ไม่สำเร็จ: ${e?.message || e}`, "bad");
  } finally {
    $("btnSetPkg").disabled = !ownerAllowed;
  }
});

// Advanced toggle
$("toggleAdvanced").addEventListener("change", (ev) => {
  const show = ev.target.checked;
  $("advancedBody").classList.toggle("hidden", !show);
});

$("btnReadPool").addEventListener("click", async () => {
  try { await readPool(); }
  catch (e) { console.error(e); setMsg(`Read pool ไม่สำเร็จ: ${e?.message || e}`, "bad"); }
});

$("btnSetPool").addEventListener("click", async () => {
  try {
    $("btnSetPool").disabled = true;
    await sendSetPoolParams();
  } catch (e) {
    console.error(e);
    setMsg(`setPoolParams ไม่สำเร็จ: ${e?.message || e}`, "bad");
  } finally {
    $("btnSetPool").disabled = !ownerAllowed;
  }
});

// Guard: clamp packageId
$("packageId").addEventListener("input", () => {
  $("packageId").value = String(clampInt($("packageId").value, PACKAGE_MIN, PACKAGE_MAX));
});

// Init
$("contractAddr").textContent = CONTRACT_ADDRESS;
disableActions(true);
setMsg("กด Connect Owner Wallet เพื่อเริ่มใช้งาน", "muted");

// Optional: reload on chain/account changes
if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => location.reload());
  window.ethereum.on("chainChanged", () => location.reload());
}
