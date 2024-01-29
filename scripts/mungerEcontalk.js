import fetch from "node-fetch";
import { parseString, Builder } from "xml2js";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const econtalkRSS = "https://feeds.simplecast.com/wgl4xEgL";
const keyword = "Munger";
const __dirname = dirname(fileURLToPath(import.meta.url));
const rawFilePath = join(__dirname, "../input", "econtalk-raw.rss");
const outputFilePath = join(__dirname, "../output", "munger-econtalk.rss");

const downloadRSSFeed = async (url) => {
  try {
    const response = await fetch(url);
    const rssText = await response.text();

    await fs.mkdir(join(__dirname, "../output"), { recursive: true });

    await fs.writeFile(rawFilePath, rssText);
    console.log(`Raw RSS feed downloaded to ${rawFilePath}`);
  } catch (error) {
    console.error("Error:", error);
  }
};

const filterRSSFeed = async (rssText) => {
  return new Promise((resolve, reject) => {
    parseString(rssText, (err, result) => {
      if (err) reject(err);

      const filteredItems = result.rss.channel[0].item.filter((item) =>
        item.title[0].toLowerCase().includes(keyword.toLowerCase())
      );

      result.rss.channel[0].item = filteredItems;
      result.rss.channel[0].title = `EconTalk | Mike Munger episodes`;

      const builder = new Builder();
      resolve(builder.buildObject(result));
    });
  });
};

const processRSSFeed = async () => {
  try {
    const rssText = await fs.readFile(rawFilePath, "utf8");
    const newRSS = await filterRSSFeed(rssText);

    await fs.writeFile(outputFilePath, newRSS);
    console.log(`Filtered RSS feed written to ${outputFilePath}`);
  } catch (error) {
    console.error("Error:", error);
  }
};

const main = async () => {
  //   downloadRSSFeed(econtalkRSS);
  processRSSFeed();
};

main();
