import { buildDeps } from "../../_lib/deps";
import { handleWebhookGet, handleWebhookPost } from "../../_lib/handlers";
import { methodNotAllowed } from "../../_lib/http";

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleWebhookGet(request, buildDeps(env));
export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handleWebhookPost(ctx.request, buildDeps(ctx.env), (p) => ctx.waitUntil(p));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["GET", "POST"]);
