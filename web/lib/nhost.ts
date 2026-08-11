import { NhostClient } from '@nhost/nhost-js';

export const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN!, // e.g. "abcde"
  region: process.env.NEXT_PUBLIC_NHOST_REGION!, // e.g. "eu-central-1"
});
