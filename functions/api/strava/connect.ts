import { buildDeps } from "../../_lib/deps";
import { handleConnect } from "../../_lib/handlers";
import { methodNotAllowed } from "../../_lib/http";

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleConnect(request, buildDeps(env));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["POST"]);
