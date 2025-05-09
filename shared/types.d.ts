export interface Domain {
  domain: string;
  enabled: boolean;
  status: {
    ownership:
      | "pending"
      | "active"
      | "deactivated"
      | "blocked"
      | "error"
      | "unknown";
    ssl:
      | "initializing"
      | "pending"
      | "active"
      | "error"
      | "unknown"
      | "deactivated";
  };
  minTLS?: string;
  zoneId?: string;
  zoneName?: string;
}

export interface Bucket {
  name: string;
  creation_date: string;

  domains?: {
    managed?: {
      enabled: boolean;
      bucketId: string;
      domain: string;
    };
    custom?: {
      domains: Domain[];
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


export interface BucketObject {
  etag: string;
  http_metadata: {
    contentType: string;
  };
  key: string;
  last_modified: string;
  size: number;
  storage_class: "standard";
}

export interface BucketDelimiter {
  key: string;
  coverImage?: string;
}
