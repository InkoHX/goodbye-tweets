import * as dotenv from "std/dotenv/mod.ts";
import * as path from "std/path/mod.ts";
import * as logger from "std/log/mod.ts";
import { delay } from "std/async/delay.ts";
import { format as duration } from "std/fmt/duration.ts";
import { parse as flags } from "std/flags/mod.ts";
import { TextLineStream } from "std/streams/mod.ts";

import { oauth1a } from "https://deno.land/x/twitter_api_fetch@v2.2.1/mod.ts";

import { importTweets } from "./archive.ts";

const {
  "user-id": userId,
  "archive-dir": archiveDir,
  "ignore-failed": ignoreFailed,
} = flags(Deno.args, {
  string: ["archive-dir", "user-id"],
  boolean: ["ignore-failed"],
  default: {
    "archive-dir": Deno.realPathSync("./archive"),
  },
});

logger.info("Loading tweet-headers from Archive...");
const tweets = await importTweets(
  path.join(archiveDir, "data", "tweet-headers.js"),
);
logger.info("Loaded tweet-headers");

const ignoreTweets = new Set<string>();
await Deno.mkdir("./data");
const deletedTweetIdsFile = await Deno.open("./data/deleted.txt", {
  read: true,
  write: true,
  create: true,
});
const failedDeleteTweetIdsFile = await Deno.open("./data/failed.txt", {
  read: true,
  write: true,
  create: true,
});
const fetcher = await makeTwitterFetcher();

{
  logger.info("Loading ignore tweets...");

  const stream = deletedTweetIdsFile.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  for await (const id of stream) {
    ignoreTweets.add(id);
  }

  if (ignoreFailed) {
    const stream = failedDeleteTweetIdsFile.readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    for await (const id of stream) {
      ignoreTweets.add(id);
    }
  }

  logger.info(`Loaded ignore ${ignoreTweets.size} tweets`);
}

let skippedCount = 0;
let deletedCount = 0;
let failedCount = 0;
const textEncoder = new TextEncoder();

for await (const { tweet } of tweets) {
  if (ignoreTweets.has(tweet.tweet_id) || tweet.user_id !== userId) {
    skippedCount++;
    logger.info(`Skip ${tweet.tweet_id}`);

    continue;
  }

  const count = async (deleted: boolean) => {
    if (deleted) {
      await deletedTweetIdsFile.write(
        textEncoder.encode(tweet.tweet_id + "\n"),
      );
      deletedCount++;
    } else {
      await failedDeleteTweetIdsFile.write(
        textEncoder.encode(tweet.tweet_id + "\n"),
      );
      failedCount++;
    }
  };

  try {
    const [deleted, response] = await deleteTweet(tweet.tweet_id);
    const delayed = await waitUntilRateLimitReset(response);

    if (delayed) {
      const [deleted, _response] = await deleteTweet(tweet.tweet_id);
      
      await count(deleted);
    } else await count(deleted);
  } catch (error) {
    logger.error(error);
    failedCount++;
  }
}

failedDeleteTweetIdsFile.close();
deletedTweetIdsFile.close();
result();
Deno.addSignalListener("SIGINT", () => {
  failedDeleteTweetIdsFile.close();
  deletedTweetIdsFile.close();
  result();
  Deno.exit(1);
});

function result() {
  logger.info("<== RESULT ==>");
  logger.info(`SUCCESS: ${deletedCount}`);
  logger.info(`SKIP: ${skippedCount}`);

  if (failedCount) logger.error(`FAILED: ${failedCount}`);
}

async function deleteTweet(
  tweetId: string,
): Promise<readonly [boolean, Response]> {
  const response = await fetcher(`/2/tweets/${tweetId}`, { method: "DELETE" });
  const { data } = await response.clone().json();

  return [data?.deleted ?? false, response];
}

async function waitUntilRateLimitReset(
  response: Response,
  now = Date.now(),
): Promise<boolean> {
  if (response.status !== 429) return false;

  const resetTimestamp = Number(response.headers.get("x-rate-limit-reset")); // UTC Unix time (seconds)
  if (!resetTimestamp) throw new TypeError('"resetTimestamp" is NaN');
  const ms = resetTimestamp * 1000 - now + 60000;

  logger.warn(
    `Wait ${duration(ms, { ignoreZero: true })} for rate limits to reset...`,
  );
  await delay(ms);

  return true;
}

function makeTwitterFetcher() {
  const {
    TWITTER_API_ACCESS_TOKEN,
    TWITTER_API_CONSUMER_KEY,
    TWITTER_API_SECRET_ACCESS_TOKEN,
    TWITTER_API_SECRET_CONSUMER_KEY,
  } = dotenv.loadSync();

  if (!TWITTER_API_ACCESS_TOKEN) {
    throw new Error('"TWITTER_API_ACCESS_TOKEN" is missing.');
  }
  if (!TWITTER_API_CONSUMER_KEY) {
    throw new Error('"TWITTER_API_CONSUMER_KEY" is missing.');
  }
  if (!TWITTER_API_SECRET_ACCESS_TOKEN) {
    throw new Error('"TWITTER_API_SECRET_ACCESS_TOKEN" is missing.');
  }
  if (!TWITTER_API_SECRET_CONSUMER_KEY) {
    throw new Error('"TWITTER_API_SECRET_CONSUMER_KEY" is missing.');
  }

  return oauth1a({
    accessToken: TWITTER_API_ACCESS_TOKEN,
    consumerKey: TWITTER_API_CONSUMER_KEY,
    secretAccessToken: TWITTER_API_SECRET_ACCESS_TOKEN,
    secretConsumerKey: TWITTER_API_SECRET_CONSUMER_KEY,
  });
}
