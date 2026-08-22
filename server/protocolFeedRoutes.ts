import express from "express";
import { getProtocolFeedByToken } from "./repositories/protocolAccessRepository";
import { renderProtocolMihomoSubscription, renderProtocolUriSubscription } from "./protocolSubscription";

export const protocolFeedRouter = express.Router();

function unixSeconds(value: unknown) {
  if (!value) return 0;
  const millis = new Date(value as any).getTime();
  return Number.isFinite(millis) && millis > 0 ? Math.floor(millis / 1000) : 0;
}

function setFeedHeaders(res: express.Response, feed: Awaited<ReturnType<typeof getProtocolFeedByToken>>, skipped: number) {
  if (!feed) return;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-ForwardX-Skipped-Entries", String(skipped));
  res.setHeader(
    "subscription-userinfo",
    `upload=0; download=${Math.max(0, Number(feed.user.trafficUsed || 0))}; total=${Math.max(0, Number(feed.user.trafficLimit || 0))}; expire=${unixSeconds(feed.user.expiresAt)}`,
  );
}

async function loadFeed(req: express.Request, res: express.Response) {
  const feed = await getProtocolFeedByToken(String(req.params.token || ""));
  if (!feed) {
    res.status(404).type("text/plain").send("Access feed not found");
    return undefined;
  }
  return feed;
}

protocolFeedRouter.get("/api/v1/access-feed/:token/mihomo", async (req, res, next) => {
  try {
    const feed = await loadFeed(req, res);
    if (!feed) return;
    const rendered = renderProtocolMihomoSubscription(feed.entries);
    if (rendered.included === 0) {
      setFeedHeaders(res, feed, rendered.skipped.length);
      res.status(404).type("text/plain").send("No compatible protocol entries");
      return;
    }
    setFeedHeaders(res, feed, rendered.skipped.length);
    res.status(200).type("text/yaml; charset=utf-8").send(rendered.content);
  } catch (error) {
    next(error);
  }
});

protocolFeedRouter.get("/api/v1/access-feed/:token", async (req, res, next) => {
  try {
    const feed = await loadFeed(req, res);
    if (!feed) return;
    const rendered = renderProtocolUriSubscription(feed.entries);
    if (rendered.included === 0) {
      setFeedHeaders(res, feed, rendered.skipped.length);
      res.status(404).type("text/plain").send("No compatible protocol entries; use the Mihomo feed for chained protocols");
      return;
    }
    setFeedHeaders(res, feed, rendered.skipped.length);
    res.status(200).type("text/plain; charset=utf-8").send(rendered.content);
  } catch (error) {
    next(error);
  }
});
