// ---------- Basic data ----------
const VOTERS = ["VOTER001", "VOTER002", "VOTER003", "VOTER004", "VOTER005"];
const CANDIDATES = ["Anita Rao", "Vikram Sethi", "Neha Kapoor"];
const START_HASH = "0".repeat(64);

let ledger;       // list of blocks (our blockchain)
let secrets;      // real choice of each block (only opened after election closes)
let paperSlips;   // VVPAT paper slips
let usedTokens;   // voters who already voted
let nodes;        // 1 = online, 0 = offline
let electionClosed;       // is the election closed?

// ---------- Show any error on the screen (helps to find mistakes) ----------
window.onerror = function (message) {
  alert("JavaScript error: " + message);
};

// ---------- SHA-256 hash function ----------
// Some browsers/settings block the built-in crypto, so we keep a backup version.
function sha256Backup(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const maxWord = Math.pow(2, 32);
  let result = "";
  const words = [];
  const bitLength = ascii.length * 8;
  let hash = [], k = [], primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while (ascii.length % 64 - 56) ascii += "\x00";
  for (let i = 0; i < ascii.length; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i) % 4) * 8;
  }
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6])) + k[i]
        + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  return result;
}

async function sha256(text) {
  if (window.crypto && window.crypto.subtle) {
    const data = new TextEncoder().encode(text);
    const buffer = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Backup(text);   // backup if the browser blocks crypto
}

// Hash of one block = hash of its important fields
function blockHash(block) {
  return sha256(block.index + block.prevHash + block.lockedBallot + block.token);
}

function nodesOnline() {
  return nodes.filter(n => n === 1).length;
}

function show(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "msg " + (type || "");
}

// ---------- Start / reset ----------
function resetDemo() {
  ledger = [];
  secrets = {};
  paperSlips = [];
  usedTokens = [];
  nodes = [1, 1, 1, 1, 1];
  electionClosed = false;
  document.getElementById("slip").innerHTML = "";
  ["voteMsg", "receiptMsg", "auditMsg"].forEach(id => show(id, ""));
  updateScreen();
}

// Show candidate radio buttons
document.getElementById("candidates").innerHTML = CANDIDATES.map(name =>
  `<label class="candidate"><input type="radio" name="candidate" value="${name}"> ${name}</label>`
).join("");

// ---------- Tabs ----------
function showTab(name) {
  ["voter", "officials", "auditor"].forEach(t => {
    document.getElementById(t).classList.toggle("hidden", t !== name);
  });
  updateScreen();
}

// ---------- VOTER: cast a vote ----------
async function castVote() {
  const id = document.getElementById("voterId").value.trim().toUpperCase();
  const chosen = document.querySelector("input[name='candidate']:checked");

  if (electionClosed) return show("voteMsg", "The election is closed.", "bad");
  if (!VOTERS.includes(id)) return show("voteMsg", "Voter ID not found. Use VOTER001 to VOTER005.", "bad");
  if (!chosen) return show("voteMsg", "Please choose a candidate.", "bad");

  // Step 1: make a one-time token (so nobody can vote twice)
  const token = await sha256("token:" + id);
  if (usedTokens.includes(token)) return show("voteMsg", "This token was already used. Double voting blocked!", "bad");

  // Step 2: network must have at least 3 nodes online
  if (nodesOnline() < 3) return show("voteMsg", "Less than 3 nodes online. Vote cannot be saved.", "bad");

  // Step 3: lock (encrypt) the vote using the choice + a random number
  const randomPart = Math.random().toString();
  const lockedBallot = await sha256(chosen.value + randomPart);

  // Step 4: make a new block and link it to the previous block
  const block = {
    index: ledger.length,
    prevHash: ledger.length === 0 ? START_HASH : ledger[ledger.length - 1].hash,
    lockedBallot: lockedBallot,
    token: token
  };
  block.hash = await blockHash(block);
  ledger.push(block);

  // Step 5: remember the real choice (secret) and print the paper slip
  secrets[block.hash] = chosen.value;
  usedTokens.push(token);
  const code = block.hash.slice(0, 8);
  paperSlips.push({ code: code, choice: chosen.value });

  show("voteMsg", "Vote saved on " + nodesOnline() + " nodes. Keep your receipt code.", "good");
  document.getElementById("slip").innerHTML =
    `<div class="slip"><b>Paper slip (VVPAT)</b><br>
     Your choice: ${chosen.value}<br>
     Receipt code: <b>${code}</b><br>
     Locked ballot: ${lockedBallot.slice(0, 24)}...</div>`;

  document.getElementById("voterId").value = "";
  chosen.checked = false;
  updateScreen();
}

// ---------- VOTER: check receipt ----------
function checkReceipt() {
  const code = document.getElementById("receiptCode").value.trim().toLowerCase();
  const block = ledger.find(b => b.hash.startsWith(code));
  if (code.length >= 6 && block) {
    show("receiptMsg", "Found in block " + (block.index + 1) + ". The ledger shows only a locked ballot, not your choice.", "good");
  } else {
    show("receiptMsg", "No block matches this code.", "bad");
  }
}

// ---------- OFFICIALS ----------
function toggleNode(i) {
  nodes[i] = nodes[i] === 1 ? 0 : 1;
  updateScreen();
}

function closeElection() {
  electionClosed = true;
  updateScreen();
}

// ---------- AUDITOR ----------
// Go through every block and check the hash and the link to the previous block
async function findBrokenBlock() {
  let previous = START_HASH;
  for (const block of ledger) {
    const correctHash = await blockHash(block);
    if (block.prevHash !== previous || block.hash !== correctHash) return block.index;
    previous = block.hash;
  }
  return -1; // -1 means everything is fine
}

async function verifyChain() {
  const broken = await findBrokenBlock();
  if (broken === -1) {
    show("auditMsg", "Chain is valid. All " + ledger.length + " blocks are correct.", "good");
  } else {
    show("auditMsg", "Tampering found at block " + (broken + 1) + "!", "bad");
  }
  updateScreen(broken);
}

function simulateAttack() {
  if (ledger.length === 0) return show("auditMsg", "Cast at least one vote first.", "bad");
  const middle = Math.floor(ledger.length / 2);
  ledger[middle].lockedBallot = "f".repeat(64);   // attacker changes a vote secretly
  show("auditMsg", "A block was changed secretly. Now click 'Verify the chain'.", "");
}

function checkPaperSlips() {
  if (!electionClosed) return show("auditMsg", "Close the election first (Officials tab).", "bad");
  if (paperSlips.length === 0) return show("auditMsg", "No paper slips yet.", "bad");
  const sample = paperSlips.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  let matches = 0;
  sample.forEach(slip => {
    const block = ledger.find(b => b.hash.startsWith(slip.code));
    if (block && secrets[block.hash] === slip.choice) matches++;
  });
  show("auditMsg", matches + " of " + sample.length + " sampled paper slips match the ledger.", matches === sample.length ? "good" : "bad");
}

// ---------- Update everything on screen ----------
function updateScreen(brokenIndex) {
  document.getElementById("totalVotes").textContent = ledger.length;
  document.getElementById("nodesOnline").textContent = nodesOnline();

  // node buttons
  document.getElementById("nodes").innerHTML = nodes.map((n, i) =>
    `<button class="node ${n ? "" : "off"}" onclick="toggleNode(${i})">${i + 1}</button>`).join("");

  // ledger
  document.getElementById("ledger").innerHTML = ledger.length === 0 ? "No blocks yet." :
    ledger.map(b => `<div class="block ${b.index === brokenIndex ? "tampered" : ""}">
      <b>Block ${b.index + 1}</b><br>hash: ${b.hash.slice(0, 20)}...<br>
      previous: ${b.prevHash.slice(0, 12)}...<br>locked ballot: ${b.lockedBallot.slice(0, 30)}...</div>`).join("");

  // results (only after closing)
  const results = document.getElementById("results");
  if (!electionClosed) {
    results.innerHTML = "";
    document.getElementById("resultNote").textContent = "Votes stay locked until the election is closed.";
    return;
  }
  document.getElementById("resultNote").textContent = "Election closed. Final count:";
  results.innerHTML = CANDIDATES.map(name => {
    const count = ledger.filter(b => secrets[b.hash] === name).length;
    return `<div>${name}: <b>${count}</b><div class="bar" style="width:${Math.max(8, count * 40)}px">${count}</div></div>`;
  }).join("");
}

resetDemo();