export interface TweetHeaderItem {
  readonly tweet_id: string;
  readonly user_id: string;
  readonly created_at: string;
}

export interface TweetHeader {
  readonly tweet: TweetHeaderItem;
}
