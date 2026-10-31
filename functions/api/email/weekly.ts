import { buildEmailDeps } from "../../_lib/email/deps";
import { handleWeekly } from "../../_lib/email/handlers";
import { guarded, methodNotAllowed } from "../../_lib/http";

export const onRequestPost: PagesFunction<Env> = guarded(({ request, env }) => handleWeekly(request, buildEmailDeps(env)));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["POST"]);
