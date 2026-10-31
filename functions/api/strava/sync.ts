import { buildDeps } from "../../_lib/deps";
import { handleSync } from "../../_lib/handlers";
import { guarded, methodNotAllowed } from "../../_lib/http";

export const onRequestPost: PagesFunction<Env> = guarded(({ request, env }) => handleSync(request, buildDeps(env)));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["POST"]);
