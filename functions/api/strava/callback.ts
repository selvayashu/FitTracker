import { buildDeps } from "../../_lib/deps";
import { handleCallback } from "../../_lib/handlers";
import { methodNotAllowed } from "../../_lib/http";

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleCallback(request, buildDeps(env));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["GET"]);
