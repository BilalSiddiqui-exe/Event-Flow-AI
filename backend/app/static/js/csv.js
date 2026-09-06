import { api } from "./api.js";
export const uploadParticipants = async (eventId, file) => {
  const form = new FormData(); form.append("file", file);
  return api.request(`/api/events/${eventId}/participants/import`, {method:"POST", body:form});
};
