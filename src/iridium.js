const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");
const utils = require("./utils");

const eventsIridium = [
  "brightness", "altitude", "azimuth", "satellite",
  "distanceToFlareCentre", "brightnessAtFlareCentre", "date", "time",
  "distanceToSatellite", "AngleOffFlareCentre-line",
  "flareProducingAntenna", "sunAltitude", "angularSeparationFromSun",
  "image", "id"
];

async function getTable(config) {
  let database = config.database || [];
  let counter = config.counter || 0;
  const opt = config.opt || 0;
  const basedir = config.root + "IridiumFlares/";

  if (counter === 0) {
    options = utils.get_options("IridiumFlares.aspx?");
    if (!fs.existsSync(basedir)) {
      fs.mkdirSync(basedir, { recursive: true });
    }
  } else {
    options = utils.post_options("IridiumFlares.aspx?", opt);
  }

  try {
    // Fetch page (GET or POST depending on options)
    const res = await fetch(options.url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body || undefined,
    });
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
    const body = await res.text();

    const $ = cheerio.load(body, { decodeEntities: false });
    let next = "__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS=";
    const tbody = $("form").find("table.standardTable tbody");
    const queue = [];

    // Extract data rows
    tbody.find("tr").each((i, o) => {
      const temp = {};
      for (let i = 0; i < 6; i++) {
        temp[eventsIridium[i]] = $(o).find("td").eq(i + 1).text();
      }
      const link = $(o).find("td").eq(0).find("a").attr("href");
      if (link)
        temp["url"] = "https://www.heavens-above.com/" + link.replace("type=V", "type=A");
      queue.push(temp);
    });

    // Helper for subpage fetch
    async function factory(temp) {
      try {
        const res = await fetch(utils.iridium_options(temp["url"]).url);
        if (!res.ok) throw new Error("Page fetch failed");
        const body = await res.text();

        console.log("Success:", temp.url);
        const $ = cheerio.load(body, { decodeEntities: false });
        const table = $("form").find("table.standardTable");
        const tr = table.find("tbody tr");

        [
          [6, 0], [7, 1], [8, 6], [9, 7], [10, 9], [11, 10], [12, 11]
        ].forEach((ele) => {
          temp[eventsIridium[ele[0]]] = tr.eq(ele[1]).find("td").eq(1).text();
        });

        const imgSrc = $("#ctl00_cph1_imgSkyChart").attr("src");
        temp[eventsIridium[13]] = "https://www.heavens-above.com/" + imgSrc;
        const id = utils.md5(Math.random().toString());
        temp[eventsIridium[14]] = id;

        // Save HTML and image
        fs.writeFileSync(basedir + id + ".html", table.html());
        const imgRes = await fetch(temp[eventsIridium[13]]);
        const buffer = await imgRes.arrayBuffer();
        fs.writeFileSync(basedir + id + ".png", Buffer.from(buffer));

        return temp;
      } catch (err) {
        console.error("Error fetching subpage:", err);
        return null;
      }
    }

    const results = await Promise.all(queue.map((temp) => factory(temp)));
    const fulfilled = results.filter(Boolean);
    database = database.concat(fulfilled);

    // Prepare next page data
    $("form")
      .find("input")
      .each((i, o) => {
        const name = $(o).attr("name");
        const val = $(o).attr("value") || "";
        if (name === "ctl00$cph1$btnPrev" || name === "ctl00$cph1$visible") return;
        next += `&${name}=${val}`;
      });
    next += "&ctl00$cph1$visible=radioVisible";
    next = next.replace(/\+/g, "%2B").replace(/\//g, "%2F");

    // Recursively process next page if needed
    if (counter++ < config.pages) {
      await getTable({
        count: config.count,
        pages: config.pages,
        root: config.root,
        counter,
        opt: next,
        database,
      });
    } else {
      fs.writeFileSync(basedir + "index.json", JSON.stringify(database, null, 2));
    }
  } catch (error) {
    console.error("Error fetching main page:", error);
  }
}

exports.getTable = getTable;
