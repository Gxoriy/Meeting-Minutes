use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// Interview profile used to ground live Q&A answers in the target job
/// description and the candidate's resume. A single active row (id = '1')
/// is stored, mirroring the settings table convention.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InterviewProfile {
    pub id: String,
    #[sqlx(rename = "jobTitle")]
    #[serde(rename = "jobTitle")]
    pub job_title: Option<String>,
    #[sqlx(rename = "jdText")]
    #[serde(rename = "jdText")]
    pub jd_text: Option<String>,
    #[sqlx(rename = "resumeText")]
    #[serde(rename = "resumeText")]
    pub resume_text: Option<String>,
    #[sqlx(rename = "answerStyle")]
    #[serde(rename = "answerStyle")]
    pub answer_style: Option<String>,
    #[sqlx(rename = "updatedAt")]
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
}

pub struct InterviewProfileRepository;

impl InterviewProfileRepository {
    /// Returns the active profile (id = '1') if present.
    pub async fn get(pool: &SqlitePool) -> Result<Option<InterviewProfile>, sqlx::Error> {
        sqlx::query_as::<_, InterviewProfile>(
            "SELECT * FROM interview_profiles WHERE id = '1' LIMIT 1",
        )
        .fetch_optional(pool)
        .await
    }

    /// Upserts the active profile.
    pub async fn save(
        pool: &SqlitePool,
        job_title: Option<&str>,
        jd_text: Option<&str>,
        resume_text: Option<&str>,
        answer_style: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        sqlx::query(
            r#"
            INSERT INTO interview_profiles (id, jobTitle, jdText, resumeText, answerStyle, updatedAt)
            VALUES ('1', $1, $2, $3, $4, $5)
            ON CONFLICT(id) DO UPDATE SET
                jobTitle = excluded.jobTitle,
                jdText = excluded.jdText,
                resumeText = excluded.resumeText,
                answerStyle = excluded.answerStyle,
                updatedAt = excluded.updatedAt
            "#,
        )
        .bind(job_title)
        .bind(jd_text)
        .bind(resume_text)
        .bind(answer_style)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Removes the active profile.
    pub async fn clear(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM interview_profiles WHERE id = '1'")
            .execute(pool)
            .await?;
        Ok(())
    }
}
