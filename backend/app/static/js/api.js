import { token } from "./auth.js";
const request = async (path, options = {}) => {
  const idToken = await token();
  const response = await fetch(path, { ...options, headers: { ...(options.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...(idToken ? {Authorization:`Bearer ${idToken}`} : {}), ...(options.headers || {}) }});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || "Request failed");
  return body;
};
export const api = { request };
