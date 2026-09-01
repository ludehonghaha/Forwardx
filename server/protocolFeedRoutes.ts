import express from "express";
import { getProtocolFeedByToken } from "./repositories/protocolAccessRepository";
import {
  ProtocolFeedIpv6UnavailableError,
  parseProtocolFeedIpVersion,
  selectProtocolFeedEntriesForIpVersion,
} from "./protocolFeedIpVersion";
import { renderProtocolMihomoSubscription, renderProtocolUriSubscription } from "./protocolSubscription";

export const protocolFeedRouter = express.Router();

function unixSeconds(value: unknown) {
  if (!value) return 0;
  const millis = new Date(value as any).getTime();
  return Number.isFinite(millis) && millis > 0 ? Math.floor(millis / 1000) : 0;
}

export function buildSubscriptionUserinfo(user: { trafficUsed?: unknown; trafficLimit?: unknown; expiresAt?: unknown }) {
  const parts = [
    "upload=0",
    `download=${Math.max(0, Number(user.trafficUsed || 0))}`,
    `total=${Math.max(0, Number(user.trafficLimit || 0))}`,
  ];
  const expire = unixSeconds(user.expiresAt);
  if (expire > 0) parts.push(`expire=${expire}`);
  return parts.join("; ");
}

function setFeedHeaders(res: express.Response, feed: Awaited<ReturnType<typeof getProtocolFeedByToken>>, skipped: number) {
  if (!feed) return;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-ForwardX-Skipped-Entries", String(skipped));
  res.setHeader("subscription-userinfo", buildSubscriptionUserinfo(feed.user));
}

function ipv6SelectionSkipped(feed: NonNullable<Awaited<ReturnType<typeof getProtocolFeedByToken>>>, entries: typeof feed.entries) {
  return Math.max(0, feed.entries.length - entries.length);
}

async function loadFeed(req: express.Request, res: express.Response) {
  const feed = await getProtocolFeedByToken(String(req.params.token || ""));
  if (!feed) {
    res.status(404).type("text/plain").send("Access feed not found");
    return undefined;
  }
  return feed;
}

async function entriesForRequest(
  req: express.Request,
  res: express.Response,
  feed: NonNullable<Awaited<ReturnType<typeof getProtocolFeedByToken>>>,
) {
  let ipVersion;
  try {
    ipVersion = parseProtocolFeedIpVersion(req.query.ipVersion);
  } catch (error) {
    setFeedHeaders(res, feed, 0);
    res.status(400).type("text/plain").send(error instanceof Error ? error.message : "ipVersion 必须是 4 或 6");
    return undefined;
  }

  try {
    return await selectProtocolFeedEntriesForIpVersion(feed.entries, ipVersion);
  } catch (error) {
    if (error instanceof ProtocolFeedIpv6UnavailableError) {
      setFeedHeaders(res, feed, feed.entries.length);
      res.status(422).type("text/plain").send(error.message);
      return undefined;
    }
    throw error;
  }
}

protocolFeedRouter.get("/api/v1/access-feed/:token/mihomo", async (req, res, next) => {
  try {
    const feed = await loadFeed(req, res);
    if (!feed) return;
    const entries = await entriesForRequest(req, res, feed);
    if (!entries) return;
    const rendered = renderProtocolMihomoSubscription(entries);
    const skipped = ipv6SelectionSkipped(feed, entries) + rendered.skipped.length;
    if (rendered.included === 0) {
      setFeedHeaders(res, feed, skipped);
      res.status(404).type("text/plain").send("No compatible protocol entries");
      return;
    }
    setFeedHeaders(res, feed, skipped);
    res.status(200).type("text/yaml; charset=utf-8").send(rendered.content);
  } catch (error) {
    next(error);
  }
});

protocolFeedRouter.get("/api/v1/access-feed/:token", async (req, res, next) => {
  try {
    const feed = await loadFeed(req, res);
    if (!feed) return;
    const entries = await entriesForRequest(req, res, feed);
    if (!entries) return;
    const rendered = renderProtocolUriSubscription(entries);
    const skipped = ipv6SelectionSkipped(feed, entries) + rendered.skipped.length;
    if (rendered.included === 0) {
      setFeedHeaders(res, feed, skipped);
      res.status(404).type("text/plain").send("No compatible protocol entries; use the Mihomo feed for chained protocols");
      return;
    }
    setFeedHeaders(res, feed, skipped);
    res.status(200).type("text/plain; charset=utf-8").send(rendered.content);
  } catch (error) {
    next(error);
  }
});
