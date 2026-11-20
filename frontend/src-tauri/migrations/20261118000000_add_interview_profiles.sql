-- Migration: Add interview profile storage for live interview Q&A assistance
-- Stores the target job description (JD), the candidate resume, and answer style.
-- A single active profile row (id = '1') is used, mirroring the settings table.

CREATE TABLE IF NOT EXISTS interview_profiles (
    id TEXT PRIMARY KEY,
    jobTitle TEXT,
    jdText TEXT,
    resumeText TEXT,
    answerStyle TEXT,
    updatedAt TEXT
);
