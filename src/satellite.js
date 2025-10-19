const cheerio = require("cheerio");
const fs = require("fs");
const fetch = require("node-fetch");
const utils = require("./utils");

const property = [
  "url", "date", "brightness", "events", "passType",
  "image", "scoreData", "exist", "score", "id"
];
const events = [
  "rise", "reachAltitude10deg", "highestPoint",
  "dropBelowAltitude10deg", "set", "exitShadow", "enterShadow"
];
const attribute = ["time", "altitude", "azimuth", "distance", "brightness", "sunAltitude"];

const compare = [
  (a, b) => (a[property[6]][1] >= b[property[6]][1] ? 1 : -1),
  (a, b) => (a[property[6]][2] >= b[property[6]][2] ? 1 : -1),
  (a, b) => (a[property[6]][3] <= b[property[6]][3] ? 1 : -1),
  (a, b) => (a[property[7]] <= b[property[7]] ? 1 : -1),
];
const weight = [9.5, 6, 6.5, 6.5];

// -----------------------------------------
// Core Scraper
// -----------------------------------------
async function getTable(config) {
  let database = config.database || [];
  let counter = config.counter || 0;
  const opt = config.opt || 0;
  const basedir = `${config.root}satellite${config.target}/`;

  if (!fs.existsSync(basedir)) fs.mkdirSync(basedir, { recursive: true });

  const options = counter === 0
    ? utils.get_options(`PassSummary.aspx?satid=${config.target}&`)
    : utils.post_options(`PassSummary.aspx?satid=${config.target}&`, opt);

  // Fetch the summary page
  const res = await fetch(options.url, options);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const body = await res.text();
  const $ = cheerio.load(body);

  // Queue of detail pages
  const tbody = $("form").find("table.standardTable tbody");
  const queue = [];
  tbody.find("tr").each((i, o) => {
    const href = $(o).find("td").eq(0).find("a").attr("href");
    if (!href) return;
    queue.push({
      [property[0]]: "https://www.heavens-above.com/" + href.replace("type=V", "type=A"),
      [property[1]]: $(o).find("td").eq(0).find("a").text(),
      [property[2]]: $(o).find("td").eq(1).text(),
      [property[3]]: {},
      [property[4]]: $(o).find("td").eq(11).text(),
    });
  });

  // Scrape each detail page safely
  const results = [];
  for (const temp of queue) {
    try {
      console.log("🔗 Fetching:", temp[property[0]]);
      const sub = await fetch(temp[property[0]]);
      console.log("Status:", sub.status);

      if (!sub.ok) {
        const preview = (await sub.text()).slice(0, 200);
        console.warn(` Sub-request failed ${sub.status} | Preview:`, preview);
        continue; // skip
      }

      const html = await sub.text();
      const $ = cheerio.load(html);
      const table = $("form").find("table.standardTable");
      const tbody = table.find("tbody");
      const data = [];

      let shift = 0, flag = false;
      tbody.find("tr").each((i, row) => {
        const label = $(row).find("td").eq(0).text();
        let current;

        if (label === "离开地影") {
          temp[property[3]][events[5]] = {};
          current = temp[property[3]][events[5]];
          shift++;
        } else if (label === "进入地影") {
          temp[property[3]][events[6]] = {};
          current = temp[property[3]][events[6]];
          shift++;
        } else {
          temp[property[3]][events[i - shift]] = {};
          current = temp[property[3]][events[i - shift]];
        }

        for (let j = 0; j < 6; j++) {
          current[attribute[j]] = $(row).find("td").eq(j + 1).text();
        }

        if (i - shift === 2 && !flag) {
          flag = true;
          data[0] = parseInt(current[attribute[0]].split(":")[0]);
          data[1] = parseFloat(current[attribute[4]]);
          data[2] = parseFloat(current[attribute[5]].split("°")[0]);
          data[3] = parseInt(current[attribute[1]].split("°")[0]);
        }
      });

      const startTime = utils.getTimestamp(
        temp[property[3]][events[5]]?.[attribute[0]] ||
        temp[property[3]][events[1]][attribute[0]]
      );
      const endTime = utils.getTimestamp(
        temp[property[3]][events[6]]?.[attribute[0]] ||
        temp[property[3]][events[3]][attribute[0]]
      );

      temp[property[5]] = "https://www.heavens-above.com/" + $("#ctl00_cph1_imgViewFinder").attr("src");
      temp[property[6]] = data;
      temp[property[7]] = endTime - startTime;
      temp[property[8]] = 0;
      const id = utils.md5(Math.random().toString());
      temp[property[9]] = id;

      fs.writeFileSync(`${basedir}${id}.html`, table.html());
      results.push(temp);
    } catch (err) {
      console.error(" Error fetching subpage:", err.message);
      continue; // skip and continue next
    }
  }

  // Merge results
  database = database.concat(results);

  // Prepare for next pagination
  let next = "__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS=";
  $("form").find("input").each((i, o) => {
    if ($(o).attr("name") === "ctl00$cph1$btnPrev" || $(o).attr("name") === "ctl00$cph1$visible") return;
    else next += `&${$(o).attr("name")}=${$(o).attr("value")}`;
  });
  next += "&ctl00$cph1$visible=radioVisible";
  next = next.replace(/\+/g, "%2B").replace(/\//g, "%2F");

  // Recursive pagination or finalize
  if (counter++ < config.pages) {
    await getTable({ ...config, counter, opt: next, database });
  } else {
    // scoring and final sort
    for (let i = 0; i < 4; i++) {
      database.sort(compare[i]);
      database = database.map((ele, index) => {
        ele[property[8]] += 100 * (1 - index / database.length) * weight[i];
        return ele;
      });
    }

    database = database.map(ele => {
      if (isNaN(ele[property[6]][1])) {
        ele[property[8]] = 0;
        return ele;
      }
      const hour = ele[property[6]][0];
      if (hour >= 17 && hour <= 19) ele[property[8]] += 850;
      else if (hour >= 20 && hour <= 23) ele[property[8]] += 950;
      else if (hour >= 0 && hour <= 3) ele[property[8]] += 400;
      else if (hour >= 4 && hour <= 6) ele[property[8]] += 300;
      ele[property[8]] = Math.floor(ele[property[8]] / 40);
      return ele;
    });

    database.sort((a, b) => (a[property[8]] <= b[property[8]] ? 1 : -1));
    fs.writeFileSync(`${basedir}index.json`, JSON.stringify(database, null, 2));
    console.log("Scraping complete. Data saved to:", `${basedir}index.json`);
  }
}

exports.getTable = getTable;
