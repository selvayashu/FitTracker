import { buildDeps } from "../../_lib/deps";
import { handleCallback } from "../../_lib/handlers";
import { guarded, methodNotAllowed } from "../../_lib/http";

export const onRequestGet: PagesFunction<Env> = guarded(({ request, env }) => handleCallback(request, buildDeps(env)));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["GET"]);
