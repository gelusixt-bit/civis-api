require("dotenv").config();

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const iconv = require("iconv-lite");

const BASE_URL = "https://www.cdep.ro";

// =====================
// 🔁 HELPER: RETRY REQUEST
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
      console.log(`⚠️ Retry ${i + 1} failed: ${url}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw new Error(`❌ Failed after retries: ${url}`);
}

// =====================
// 🔧 NORMALIZE
// =====================
function normalizeId(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_");
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
// 📧 PROFILE SCRAPER
// =====================
async function scrapeProfile(url) {
  try {
    const buffer = await fetchWithRetry(url);
    const html = iconv.decode(buffer, "latin2");
    const $ = cheerio.load(html);

    let email = "";

    const mailto = $("a[href^='mailto:']").attr("href");
    if (mailto) {
      email = mailto.replace("mailto:", "").trim();
    }

    if (!email) {
      const text = $("body").text();
      const match = text.match(/[A-Z0-9._%+-]+@cdep\.ro/i);
      if (match) email = match[0];
    }

    return { email };
  } catch (e) {
    console.log("❌ profile error:", url);
    return { email: "" };
  }
}

// =====================
// 🧠 MAIN SCRAPER
// =====================
async function scrape() {
  const url = `${BASE_URL}/pls/parlam/structura2015.mp`;

  const buffer = await fetchWithRetry(url);
  const html = iconv.decode(buffer, "latin2");
  const $ = cheerio.load(html);

  const politicians = [];

  const rows = $("table tr").toArray();

  console.log("📊 Total rows:", rows.length);

  for (let i = 0; i < rows.length; i++) {
    const el = rows[i];
    const cols = $(el).find("td");

    if (cols.length < 4) continue;

    const linkEl = cols.eq(1).find("a");

    const name = linkEl.text().trim();
    const relativeLink = linkEl.attr("href");

    if (!name || name.length < 5) continue;

    const profileUrl = relativeLink
      ? `${BASE_URL}${relativeLink}`
      : null;

    const countyRaw =
      cols.eq(2).find("a").text().trim() ||
      cols.eq(2).text().trim();

    const county =
      countyRaw.split("/")[1]?.trim() || countyRaw;

    const rawParty = cols.eq(3).text().trim();
    const party = normalizeParty(rawParty);

    let email = "";

    if (profileUrl) {
      const profileData = await scrapeProfile(profileUrl);
      email = profileData.email;

      // 🧠 RATE LIMIT (foarte important)
      await new Promise((r) => setTimeout(r, 300));
    }

    const id = normalizeId(name);

    console.log("✔", name);

    politicians.push({
      id,
      name,
      role: "Deputat",
      party,

      contact: {
        email,
        phone: "",
      },

      location: {
        county,
        address: "",
      },

      activity: {
        presence: 50,
        initiatives: 10,
        votes: 50,
        media: 50,
      },

      score: 0,
      imageUrl: "",

      meta: {
        updatedAt: Date.now(),
      },
    });
  }

  console.log("🔥 TOTAL:", politicians.length);

  return { politicians };
}

// =====================
// 💾 SAVE
// =====================
function saveToFile(data) {
  fs.writeFileSync(
    "politicians.json",
    JSON.stringify(data, null, 2)
  );
  console.log("💾 Saved JSON");
}

// =====================
// 🚀 RUN
// =====================
async function run() {
  try {
    const data = await scrape();
    saveToFile(data);
    console.log("✅ DONE");
  } catch (e) {
    console.error("❌ ERROR:", e.message);
  }
}

run();
