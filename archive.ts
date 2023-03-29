import { TweetHeader } from "./types/tweet-header.d.ts";

/**
 * @param path
 * @returns
 */
export const importTweets = async (path: string | URL) => {
  const file = await Deno.readTextFile(path);
  const data = JSON.parse(
    file.replace(/^window\.YTD\.tweet_headers\.part\d\s*=\s*/, ""),
  ) as ReadonlyArray<TweetHeader>;

  return data;
};
