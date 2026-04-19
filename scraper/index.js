const admin = require("firebase-admin");

/// 🔥 INIT SAFE (GitHub + Firebase)
if (!admin.apps.length) {
  if (process.env.FIREBASE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_KEY)
      ),
    });
    console.log("🔥 Firebase initialized via KEY");
  } else {
    admin.initializeApp();
    console.log("🔥 Firebase initialized default");
  }
}

const db = admin.firestore();

const { onSchedule } = require("firebase-functions/v2/scheduler");

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const iconv = require("iconv-lite");

const BASE_URL = "https://www.cdep.ro";

// =====================
// 🔁 RETRY
// =====================
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      });

      return res.data;
    } catch (e) {
      console.log(`⚠️ Retry ${i + 1}: ${url}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw new Error(`❌ Failed: ${url}`);
}

// =====================
// 🔧 NORMALIZE
// =====================
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "");
}

/// 🔥 ID UNIC (IMPORTANT)
function createId(name) {
  return normalize(name).replace(/\s+/g, "_");
}

function normalizeParty(party) {
  if (party.includes("PSD")) return "PSD";
  if (party.includes("PNL")) return "PNL";
  if (party.includes("USR")) return "USR";
  if (party.includes("AUR")) return "AUR";
  if (party.includes("SOS")) return "SOS";
  if (party.includes("Neafilia")) return "Independent";
  if (party.includes("Minorit")) return "Minoritati";
  return party;
}

// =====================
// 🧠 SCRAPER
// =====================
async function scrape() {
  const url = `${BASE_URL}/pls/parlam/structura2015.mp`;

  const buffer = await fetchWithRetry(url);
  const html = iconv.decode(buffer, "latin2");
  const $ = cheerio.load(html);

  const politicians = [];
  const rows = $("table tr").toArray();

  console.log("📊 Rows:", rows.length);

  for (const el of rows) {
    const cols = $(el).find("td");
    if (cols.length < 4) continue;

    const linkEl = cols.eq(1).find("a");

    const name = linkEl.text().trim();
    if (!name || name.length < 5) continue;

    const countyRaw =
      cols.eq(2).find("a").text().trim() ||
      cols.eq(2).text().trim();

    const county =
      countyRaw.split("/")[1]?.trim() || countyRaw;

    const party = normalizeParty(cols.eq(3).text().trim());

    const id = createId(name);

    politicians.push({
      id,
      name,
      party,
      county,
      email: "",
      updatedAt: Date.now(),
    });

    console.log("✔", name);
  }

  console.log("🔥 TOTAL:", politicians.length);

  return politicians;
}

// =====================
// 💾 UPSERT FIRESTORE (SAFE)
// =====================
async function saveToFirestore(politicians) {
  console.log("🔥 Writing to Firestore (UPSERT MODE)...");

  const batchSize = 400;
  let batch = db.batch();
  let count = 0;
  let total = 0;

  for (const p of politicians) {
    const ref = db.collection("politicians").doc(p.id);

    batch.set(
      ref,
      {
        ...p,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    count++;
    total++;

    if (count === batchSize) {
      await batch.commit();
      console.log("✅ Batch committed:", total);

      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log("✅ Firestore UPSERT DONE:", total);
}

// =====================
// 💾 SAVE LOCAL (optional)
// =====================
function saveToFile(data) {
  fs.writeFileSync(
    "politicians.json",
    JSON.stringify(data, null, 2)
  );
  console.log("💾 JSON saved");
}

// =====================
// ☁️ CLOUD FUNCTION
// =====================
exports.syncPoliticians = onSchedule(
  {
    schedule: "every 24 hours", // 🔥 test: "every 5 minutes"
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async () => {
    console.log("🔥 SYNC POLITICIANS START");

    try {
      const politicians = await scrape();

      await saveToFirestore(politicians);

      console.log("🔥 SYNC POLITICIANS DONE:", politicians.length);
    } catch (e) {
      console.error("❌ ERROR:", e.message);
    }
  }
);

// =====================
// ▶️ RUN LOCAL (optional)
// =====================
if (require.main === module) {
  (async () => {
    try {
      const politicians = await scrape();

      await saveToFirestore(politicians);
      saveToFile(politicians);

      console.log("✅ LOCAL DONE");
    } catch (e) {
      console.error("❌ ERROR:", e.message);
    }
  })();
}