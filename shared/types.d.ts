export interface Bucket {
  name: string;
  creation_date: string;

  domains?: {
    managed?: {
      enabled: boolean;
      bucketId: string;
      domain: string;
    };
  };
}

export interface Config {
  accountId?: string;
  r2Token?: string;
  lastOpenedBucket?: string;
  license: string;
  activated: boolean;
  instance_id: string;
}
