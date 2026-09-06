import { api } from "./api.js";
export const generateQuiz = (eventId, configuration) => api.request(`/api/events/${eventId}/quizzes/generate`, {method:"POST", body:JSON.stringify(configuration)});
export const createQuiz = (eventId, quiz) => api.request(`/api/events/${eventId}/quizzes`, {method:"POST", body:JSON.stringify(quiz)});
export const listQuizzes = (eventId) => api.request(`/api/events/${eventId}/quizzes`);
export const publishQuiz = (quizId) => api.request(`/api/quizzes/${quizId}/publish`, {method:"POST"});
export const deleteQuiz = (quizId) => api.request(`/api/quizzes/${quizId}`, {method:"DELETE"});
export const quizAnalytics = (quizId) => api.request(`/api/quizzes/${quizId}/analytics`);
export const submitQuiz = (quizId, answers, name = "", email = "", startedAt = "") => api.request(`/api/quizzes/${quizId}/submit`, {method:"POST", body:JSON.stringify({answers, participantName: name, participantEmail: email, startedAt})});
