import fetch from "node-fetch";
import { parseString, Builder } from "xml2js";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// RSS feed URLs
const THINK_BIG_RSS = "https://anchor.fm/s/108342c28/podcast/rss";

// File paths
const INPUT_DIR = join(__dirname, "../input");
const OUTPUT_DIR = join(__dirname, "../output");

// Show configurations
const SHOWS = {
  "drugs-n-stuff": {
    name: "Drugs N Stuff",
    description: "PED education with Dave Crosland and Scott McNally. A pull no punches, honest look inside the world of performance enhancing drugs.",
    archiveFile: "advicesradio-drugs-n-stuff.json",
    soundcloudFile: "soundcloud-drugs-n-stuff.json",
    outputFile: "drugs-n-stuff.rss",
    // Match "Drugs n Stuff", "Drug n Stuff" (singular), and "DNS"
    patterns: [/drugs?\s*n\s*stuff/i, /\bDNS\s+\d+/i],
    mp3Prefix: "DS",
  },
  "muscle-minds": {
    name: "Muscle Minds",
    description: "Bodybuilding science with Dr. Scott Stevenson and Scott McNally. Deep dives into training principles, muscle physiology, and evidence-based bodybuilding.",
    archiveFile: "advicesradio-muscle-minds.json",
    soundcloudFile: "soundcloud-muscle-minds.json",
    outputFile: "muscle-minds.rss",
    patterns: [/muscle\s*minds/i],
    mp3Prefix: "MM",
  },
};

/**
 * Extract episode number from title
 */
function extractEpisodeNumber(title) {
  // Pattern 1: "Drugs n Stuff 291", "Drug n Stuff 286", "Muscle Minds 179"
  const numMatch = title.match(/(?:drugs?\s*n\s*stuff|muscle\s*minds)[,\s|]*(\d+)/i);
  if (numMatch) return parseInt(numMatch[1], 10);

  // Pattern 2: "DNS 286" or "DNS286"
  const dnsMatch = title.match(/\bDNS\s*(\d+)/i);
  if (dnsMatch) return parseInt(dnsMatch[1], 10);

  // Pattern 3: "Episode ##" or "episode ##"
  const epMatch = title.match(/episode\s*(\d+)/i);
  if (epMatch) return parseInt(epMatch[1], 10);

  return null;
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Handle "DD Mon YYYY" format from scraped data
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

/**
 * Download and parse RSS feed
 */
async function fetchRSSFeed(url) {
  console.log(`Fetching RSS feed: ${url}`);
  const response = await fetch(url);
  const rssText = await response.text();

  return new Promise((resolve, reject) => {
    parseString(rssText, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Load archived episodes from JSON file
 */
async function loadArchivedEpisodes(filename) {
  const filePath = join(INPUT_DIR, filename);
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(`Warning: Could not load ${filename}: ${error.message}`);
    return [];
  }
}

/**
 * Filter RSS items by show name
 */
function filterItemsByShow(items, patterns) {
  return items.filter((item) => {
    const title = item.title?.[0] || "";
    return patterns.some((pattern) => pattern.test(title));
  });
}

/**
 * Convert archived episode to RSS item format
 */
function archivedToRSSItem(episode) {
  const pubDate = parseDate(episode.date);
  const guidValue = episode.trackUrl || `archive-${episode.episodeNumber}`;

  return {
    title: [episode.title],
    description: [episode.title],
    pubDate: [pubDate ? pubDate.toUTCString() : ""],
    enclosure: episode.mp3Url ? [{
      $: {
        url: episode.mp3Url,
        type: "audio/mpeg",
        length: "0",
      },
    }] : [],
    guid: [{ _: guidValue, $: { isPermaLink: episode.trackUrl ? "true" : "false" } }],
    link: episode.trackUrl ? [episode.trackUrl] : [],
    _episodeNumber: episode.episodeNumber,
    _source: "archive",
  };
}

/**
 * Convert SoundCloud episode to RSS item format
 */
function soundcloudToRSSItem(episode) {
  const guidValue = episode.url || `soundcloud-${episode.episodeNumber}`;
  const pubDate = episode.datetime ? new Date(episode.datetime).toUTCString() : "";
  return {
    title: [episode.title],
    description: [episode.title],
    pubDate: [pubDate],
    enclosure: episode.mp3Url ? [{
      $: {
        url: episode.mp3Url,
        type: "audio/mpeg",
        length: "0",
      },
    }] : [],
    guid: [{ _: guidValue, $: { isPermaLink: episode.url ? "true" : "false" } }],
    link: episode.url ? [episode.url] : [],
    _episodeNumber: episode.episodeNumber,
    _source: "soundcloud",
  };
}

/**
 * Merge and deduplicate episodes by episode number
 * Priority: RSS > SoundCloud > Archive (RSS has best metadata)
 */
function mergeAndDeduplicate(rssItems, archivedEpisodes, soundcloudEpisodes = []) {
  const episodeMap = new Map();

  // Add RSS items first (they're more recent/have better metadata)
  for (const item of rssItems) {
    const title = item.title?.[0] || "";
    const epNum = extractEpisodeNumber(title);

    if (epNum !== null) {
      item._episodeNumber = epNum;
      item._source = "rss";

      // Prefer RSS version (newer, better metadata)
      if (!episodeMap.has(epNum)) {
        episodeMap.set(epNum, item);
      } else {
        // If existing is from archive/soundcloud and this is from RSS, prefer RSS
        const existing = episodeMap.get(epNum);
        if (existing._source !== "rss") {
          episodeMap.set(epNum, item);
        }
      }
    }
  }

  // Add SoundCloud episodes (fill in gaps, prefer over archive)
  for (const episode of soundcloudEpisodes) {
    const epNum = episode.episodeNumber;
    if (epNum !== null && !episodeMap.has(epNum)) {
      episodeMap.set(epNum, soundcloudToRSSItem(episode));
    }
  }

  // Add archived episodes (fill in remaining gaps)
  for (const episode of archivedEpisodes) {
    const epNum = episode.episodeNumber;
    if (epNum !== null && !episodeMap.has(epNum)) {
      episodeMap.set(epNum, archivedToRSSItem(episode));
    }
  }

  // Sort by episode number descending
  const episodes = Array.from(episodeMap.values());
  episodes.sort((a, b) => (b._episodeNumber || 0) - (a._episodeNumber || 0));

  // Clean up internal properties
  return episodes.map((ep) => {
    const { _episodeNumber, _source, ...cleanItem } = ep;
    return cleanItem;
  });
}

/**
 * Build RSS feed XML
 */
function buildRSSFeed(originalFeed, items, showConfig) {
  const feed = JSON.parse(JSON.stringify(originalFeed));
  const channel = feed.rss.channel[0];

  // Update channel metadata
  channel.title = [showConfig.name];
  channel.description = [showConfig.description];

  // Update iTunes metadata if present
  if (channel["itunes:title"]) {
    channel["itunes:title"] = [showConfig.name];
  }
  if (channel["itunes:summary"]) {
    channel["itunes:summary"] = [showConfig.description];
  }

  // Set items
  channel.item = items;

  const builder = new Builder();
  return builder.buildObject(feed);
}

/**
 * Process a single show
 */
async function processShow(showKey, showConfig, thinkBigFeed) {
  console.log(`\nProcessing ${showConfig.name}...`);

  // Filter RSS items for this show
  const rssItems = filterItemsByShow(
    thinkBigFeed.rss.channel[0].item || [],
    showConfig.patterns
  );
  console.log(`  Found ${rssItems.length} episodes in Think Big RSS`);

  // Load SoundCloud episodes
  const soundcloudEpisodes = showConfig.soundcloudFile
    ? await loadArchivedEpisodes(showConfig.soundcloudFile)
    : [];
  console.log(`  Found ${soundcloudEpisodes.length} episodes in SoundCloud`);

  // Load archived episodes
  const archivedEpisodes = await loadArchivedEpisodes(showConfig.archiveFile);
  console.log(`  Found ${archivedEpisodes.length} episodes in archive`);

  // Merge and deduplicate
  const mergedItems = mergeAndDeduplicate(rssItems, archivedEpisodes, soundcloudEpisodes);
  console.log(`  Total unique episodes: ${mergedItems.length}`);

  // Build RSS feed
  const rssFeed = buildRSSFeed(thinkBigFeed, mergedItems, showConfig);

  // Write output
  const outputPath = join(OUTPUT_DIR, showConfig.outputFile);
  await fs.writeFile(outputPath, rssFeed);
  console.log(`  Written to ${outputPath}`);
}

/**
 * Main function
 */
async function main() {
  console.log("Think Big Bodybuilding Feed Splitter");
  console.log("=====================================\n");

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Fetch Think Big RSS feed
  const thinkBigFeed = await fetchRSSFeed(THINK_BIG_RSS);
  const totalItems = thinkBigFeed.rss.channel[0].item?.length || 0;
  console.log(`Fetched Think Big feed: ${totalItems} total items`);

  // Process each show
  for (const [showKey, showConfig] of Object.entries(SHOWS)) {
    await processShow(showKey, showConfig, thinkBigFeed);
  }

  console.log("\nDone!");
}

main().catch(console.error);
