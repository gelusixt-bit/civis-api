require("dotenv").config();

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const iconv = require("iconv-lite");

// 🔥 CONFIG
const BASE_URL = "https://www.cdep.ro";

// =====================
// 🔧 NORMALIZE ID
// =====================
function normalizeId(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_");
}

// =====================
// 🔧 NORMALIZE PARTY
// =====================
function normalizeParty(party) {
  if (party.includes("PSD")) return "PSD";
  if (party.includes("PNL")) return "PNL";
  if (party.includes("USR")) return "USR";
  if (party.includes("AUR")) return "AUR";
  if (party.includes("SOS")) return "SOS";
  if (party.includes("Neafilia")) return "Independent";
  if (party.includes("Minoritati")) return "MINORITATI";
  return party;
}

// =====================
// 🧠 SCRAPE PROFIL (EMAIL)
// =====================
async function scrapeProfile(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });

    const html = iconv.decode(response.data, "latin2");
    const $ = cheerio.load(html);

    let email = "";

    // 1. mailto
    const mailto = $("a[href^='mailto:']").attr("href");
    if (mailto) {
      email = mailto.replace("mailto:", "").trim();
    }

    // 2. fallback regex
    if (!email) {
      const bodyText = $("body").text();
      const match = bodyText.match(/[A-Z0-9._%+-]+@cdep\.ro/i);
      if (match) {
        email = match[0];
      }
    }

    return { email };
  } catch (e) {
    console.error("Profile error:", url);
    return { email: "" };
  }
}

// =====================
// 🧠 SCRAPE LISTĂ
// =====================
async function scrape() {
  const url = `${BASE_URL}/pls/parlam/structura2015.mp`;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 10000,
  });

  const html = iconv.decode(response.data, "latin2");
  const $ = cheerio.load(html);

  const politicians = [];
  const rows = $("table tr").toArray();

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

    // 🎯 PARTY (mutat sus — FIX BUG)
    const rawParty = cols.eq(3).text().trim();
    const party = normalizeParty(rawParty);

    // 🏛 COUNTY
    const countyRaw =
      cols.eq(2).find("a").text().trim() ||
      cols.eq(2).text().trim();

    const county =
      countyRaw.split("/")[1]?.trim() ||
      (party === "MINORITATI" ? "NATIONAL" : countyRaw);

    // 📧 EMAIL
    let email = "";
    if (profileUrl) {
      const profileData = await scrapeProfile(profileUrl);
      email = profileData.email;
    }

    const id = normalizeId(name);

    console.log("✔", name, "|", party, "|", county, "|", email);

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

      score: 0, // 🔥 pregătit pentru AI ranking

      imageUrl: "",

      meta: {
        updatedAt: Date.now(),
      },
    });

    // ⚠️ limit test
 //   if (politicians.length >= 20) break;
  }

  console.log("🔥 TOTAL:", politicians.length);

  return { politicians };
}

// =====================
// 💾 SAVE LOCAL
// =====================
function saveToFile(data) {
  fs.writeFileSync(
    "politicians.json",
    JSON.stringify(data, null, 2)
  );
  console.log("💾 Saved locally");
}

async function uploadToGitHub(content) {
  const {
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_FILE,
  } = process.env;

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  let sha = null;

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
      },
    });
    sha = res.data.sha;
  } catch (e) {
    console.log("📄 File does not exist, creating...");
  }

  await axios.put(
    url,
    {
      message: "auto update politicians",
      content: Buffer.from(content).toString("base64"),
      sha,
    },
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
      },
    }
  );

  console.log("🚀 Uploaded to GitHub");
}
// =====================
// 🚀 MAIN
// =====================
async function run() {
  try {
    const data = await scrape();
    saveToFile(data);
    console.log("✅ DONE");
    await uploadToGitHub(JSON.stringify(data, null, 2));
    console.log("✅ Up to github DONE");
  } catch (e) {
    console.error("❌ ERROR:", e.message);
  }
}

run();
