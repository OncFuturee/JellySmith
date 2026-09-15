use crate::tasks::{open_database, TmdbCandidate};
use reqwest::blocking::{Client, Response};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, thread, time::Duration};

const API_BASE: &str = "https://api.themoviedb.org/3";
type PaletteBucket = (f64, u32, u64, u64, u64);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbEpisode {
    pub season: u16,
    pub episode: u16,
    pub title: String,
    pub overview: String,
    pub air_date: Option<String>,
    pub still_path: Option<String>,
    pub runtime: Option<u16>,
    pub vote_average: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbSeasonSummary {
    pub season: u16,
    pub name: String,
    pub overview: String,
    pub air_date: Option<String>,
    pub poster_path: Option<String>,
    pub episode_count: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbDetails {
    pub id: u64,
    pub media_type: String,
    pub title: String,
    pub original_title: String,
    pub year: Option<u16>,
    pub overview: String,
    pub tagline: String,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub vote_average: f64,
    pub vote_count: u64,
    pub status: String,
    pub original_language: String,
    pub genres: Vec<String>,
    pub runtime: Option<u16>,
    pub number_of_seasons: Option<u16>,
    pub number_of_episodes: Option<u32>,
    pub seasons: Vec<TmdbSeasonSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbImageColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbImagePalette {
    pub colors: Vec<TmdbImageColor>,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("JellySmith/0.1")
        .build()
        .map_err(|_| "tmdb-client-failed".into())
}

fn send_with_retry(
    request: impl Fn() -> reqwest::blocking::RequestBuilder,
) -> Result<Response, String> {
    for attempt in 0..3 {
        let response = request().send().map_err(|_| "tmdb-network-error")?;
        if response.status().as_u16() != 429 {
            return Ok(response);
        }
        let delay = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(1)
            .min(5);
        if attempt < 2 {
            thread::sleep(Duration::from_secs(delay));
        }
    }
    Err("tmdb-rate-limited".into())
}

fn cached(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let connection = open_database(app)?;
    connection
        .query_row(
            "SELECT body FROM tmdb_cache WHERE cache_key=?1 AND expires_at>?2",
            rusqlite::params![key, super::tasks::unix_now()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "tmdb-cache-failed".into())
}
fn cache(app: &tauri::AppHandle, key: &str, body: &str, ttl: u64) -> Result<(), String> {
    let connection = open_database(app)?;
    connection.execute("INSERT INTO tmdb_cache(cache_key,body,expires_at) VALUES(?1,?2,?3) ON CONFLICT(cache_key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at",rusqlite::params![key,body,(super::tasks::unix_now()+ttl) as i64]).map_err(|_|"tmdb-cache-failed")?;
    Ok(())
}

fn read_json(
    app: &tauri::AppHandle,
    key: &str,
    ttl: u64,
    refresh: bool,
    request: impl Fn() -> reqwest::blocking::RequestBuilder,
) -> Result<Value, String> {
    if !refresh {
        if let Some(body) = cached(app, key)? {
            return serde_json::from_str(&body).map_err(|_| "tmdb-response-invalid".into());
        }
    }
    let response = send_with_retry(request)?;
    if !response.status().is_success() {
        return Err(format!("tmdb-http-{}", response.status().as_u16()));
    }
    let body = response.text().map_err(|_| "tmdb-response-invalid")?;
    let value = serde_json::from_str(&body).map_err(|_| "tmdb-response-invalid")?;
    cache(app, key, &body, ttl)?;
    Ok(value)
}

fn year(value: Option<&str>) -> Option<u16> {
    value
        .and_then(|date| date.get(0..4))
        .and_then(|value| value.parse().ok())
}

fn parse_details(value: &Value, media_type: &str) -> Result<TmdbDetails, String> {
    let title_key = if media_type == "movie" {
        "title"
    } else {
        "name"
    };
    let original_title_key = if media_type == "movie" {
        "original_title"
    } else {
        "original_name"
    };
    let date_key = if media_type == "movie" {
        "release_date"
    } else {
        "first_air_date"
    };
    let id = value
        .get("id")
        .and_then(Value::as_u64)
        .ok_or("tmdb-response-invalid")?;
    let title = value
        .get(title_key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if title.is_empty() {
        return Err("tmdb-response-invalid".into());
    }
    let original_title = value
        .get(original_title_key)
        .and_then(Value::as_str)
        .unwrap_or(&title)
        .to_string();
    let genres = value
        .get("genres")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let seasons = value
        .get("seasons")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(TmdbSeasonSummary {
                        season: item.get("season_number")?.as_u64()? as u16,
                        name: item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        overview: item
                            .get("overview")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        air_date: item
                            .get("air_date")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        poster_path: item
                            .get("poster_path")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        episode_count: item
                            .get("episode_count")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as u16,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(TmdbDetails {
        id,
        media_type: media_type.to_string(),
        title,
        original_title,
        year: year(value.get(date_key).and_then(Value::as_str)),
        overview: value
            .get("overview")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        tagline: value
            .get("tagline")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        poster_path: value
            .get("poster_path")
            .and_then(Value::as_str)
            .map(str::to_string),
        backdrop_path: value
            .get("backdrop_path")
            .and_then(Value::as_str)
            .map(str::to_string),
        vote_average: value
            .get("vote_average")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        vote_count: value.get("vote_count").and_then(Value::as_u64).unwrap_or(0),
        status: value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        original_language: value
            .get("original_language")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        genres,
        runtime: value
            .get("runtime")
            .and_then(Value::as_u64)
            .or_else(|| {
                value
                    .get("episode_run_time")
                    .and_then(Value::as_array)
                    .and_then(|items| items.first())
                    .and_then(Value::as_u64)
            })
            .map(|runtime| runtime as u16),
        number_of_seasons: value
            .get("number_of_seasons")
            .and_then(Value::as_u64)
            .map(|count| count as u16),
        number_of_episodes: value
            .get("number_of_episodes")
            .and_then(Value::as_u64)
            .map(|count| count as u32),
        seasons,
    })
}

fn search_sync(
    app: tauri::AppHandle,
    query: String,
    media_type: String,
    language: String,
    page: u16,
    refresh: bool,
) -> Result<Vec<TmdbCandidate>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    if !matches!(media_type.as_str(), "movie" | "tv") {
        return Err("media-type-invalid".into());
    }
    let token = crate::settings::api_key("tmdb")?;
    let endpoint = format!("{API_BASE}/search/{media_type}");
    let cache_key = format!(
        "search:{media_type}:{language}:{page}:{}",
        query.trim().to_ascii_lowercase()
    );
    let http = client()?;
    let value = read_json(&app, &cache_key, 24 * 60 * 60 * 1000, refresh, || {
        http.get(&endpoint).bearer_auth(&token).query(&[
            ("query", query.trim()),
            ("language", language.as_str()),
            ("page", &page.to_string()),
            ("include_adult", "false"),
        ])
    })?;
    let items = value
        .get("results")
        .and_then(Value::as_array)
        .ok_or("tmdb-response-invalid")?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_u64()?;
            let title = item
                .get(if media_type == "movie" {
                    "title"
                } else {
                    "name"
                })
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let original_title = item
                .get(if media_type == "movie" {
                    "original_title"
                } else {
                    "original_name"
                })
                .and_then(Value::as_str)
                .unwrap_or(&title)
                .to_string();
            Some(TmdbCandidate {
                id,
                media_type: media_type.clone(),
                title,
                original_title,
                year: year(
                    item.get(if media_type == "movie" {
                        "release_date"
                    } else {
                        "first_air_date"
                    })
                    .and_then(Value::as_str),
                ),
                overview: item
                    .get("overview")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                poster_path: item
                    .get("poster_path")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                vote_average: item
                    .get("vote_average")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn search_tmdb(
    app: tauri::AppHandle,
    query: String,
    media_type: String,
    language: String,
    page: Option<u16>,
    refresh: Option<bool>,
) -> Result<Vec<TmdbCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_sync(
            app,
            query,
            media_type,
            language,
            page.unwrap_or(1).max(1),
            refresh.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| "tmdb-job-failed")?
}

fn details_sync(
    app: tauri::AppHandle,
    tmdb_id: u64,
    media_type: String,
    language: String,
    refresh: bool,
) -> Result<TmdbDetails, String> {
    if tmdb_id == 0 || !matches!(media_type.as_str(), "movie" | "tv") {
        return Err("media-type-invalid".into());
    }
    let token = crate::settings::api_key("tmdb")?;
    let endpoint = format!("{API_BASE}/{media_type}/{tmdb_id}");
    let cache_key = format!("details:{media_type}:{tmdb_id}:{language}");
    let http = client()?;
    let value = read_json(&app, &cache_key, 7 * 24 * 60 * 60 * 1000, refresh, || {
        http.get(&endpoint)
            .bearer_auth(&token)
            .query(&[("language", language.as_str())])
    })?;
    parse_details(&value, &media_type)
}

#[tauri::command]
pub async fn get_tmdb_details(
    app: tauri::AppHandle,
    tmdb_id: u64,
    media_type: String,
    language: String,
    refresh: Option<bool>,
) -> Result<TmdbDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        details_sync(app, tmdb_id, media_type, language, refresh.unwrap_or(false))
    })
    .await
    .map_err(|_| "tmdb-job-failed")?
}

fn dominant_image_palette(bytes: &[u8]) -> Result<TmdbImagePalette, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|_| "tmdb-image-invalid")?
        .thumbnail(40, 40)
        .to_rgb8();
    let mut buckets: HashMap<(u8, u8, u8), PaletteBucket> = HashMap::new();
    for pixel in image.pixels() {
        let red = pixel[0];
        let green = pixel[1];
        let blue = pixel[2];
        let maximum = red.max(green).max(blue) as f64 / 255.0;
        let minimum = red.min(green).min(blue) as f64 / 255.0;
        let lightness = (maximum + minimum) / 2.0;
        if !(0.08..=0.94).contains(&lightness) {
            continue;
        }
        let delta = maximum - minimum;
        let saturation = if delta == 0.0 {
            0.0
        } else {
            delta / (1.0 - (2.0 * lightness - 1.0).abs())
        };
        let weight = (0.35 + saturation * 1.8) * (1.0 - (lightness - 0.52).abs() * 0.65);
        let bucket = buckets
            .entry((red >> 5, green >> 5, blue >> 5))
            .or_insert((0.0, 0, 0, 0, 0));
        bucket.0 += weight;
        bucket.1 += 1;
        bucket.2 += red as u64;
        bucket.3 += green as u64;
        bucket.4 += blue as u64;
    }
    let mut candidates = buckets
        .into_values()
        .filter(|(_, count, _, _, _)| *count > 0)
        .map(|(weight, count, red, green, blue)| {
            (
                weight,
                TmdbImageColor {
                    red: (red / count as u64) as u8,
                    green: (green / count as u64) as u8,
                    blue: (blue / count as u64) as u8,
                },
            )
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.total_cmp(&left.0));

    let mut colors = Vec::with_capacity(3);
    for (_, candidate) in &candidates {
        let sufficiently_distinct = colors.iter().all(|selected: &TmdbImageColor| {
            let red = selected.red as i32 - candidate.red as i32;
            let green = selected.green as i32 - candidate.green as i32;
            let blue = selected.blue as i32 - candidate.blue as i32;
            red * red + green * green + blue * blue >= 42 * 42
        });
        if sufficiently_distinct {
            colors.push(candidate.clone());
        }
        if colors.len() == 3 {
            break;
        }
    }
    if colors.is_empty() {
        return Err("tmdb-image-invalid".into());
    }
    for (_, candidate) in candidates {
        if colors.len() == 3 {
            break;
        }
        if !colors.iter().any(|selected| {
            selected.red == candidate.red
                && selected.green == candidate.green
                && selected.blue == candidate.blue
        }) {
            colors.push(candidate);
        }
    }
    Ok(TmdbImagePalette { colors })
}

fn dominant_image_color(bytes: &[u8]) -> Result<TmdbImageColor, String> {
    dominant_image_palette(bytes)?
        .colors
        .into_iter()
        .next()
        .ok_or_else(|| "tmdb-image-invalid".into())
}

fn image_color_sync(app: tauri::AppHandle, poster_path: String) -> Result<TmdbImageColor, String> {
    if !poster_path.starts_with('/') || poster_path.contains("..") || poster_path.len() > 240 {
        return Err("tmdb-image-path-invalid".into());
    }
    let cache_key = format!("palette:{poster_path}");
    if let Some(body) = cached(&app, &cache_key)? {
        return serde_json::from_str(&body).map_err(|_| "tmdb-cache-failed".into());
    }
    let url = format!("https://image.tmdb.org/t/p/w92{poster_path}");
    let http = client()?;
    let response = send_with_retry(|| http.get(&url))?;
    if !response.status().is_success() {
        return Err(format!("tmdb-http-{}", response.status().as_u16()));
    }
    let bytes = response.bytes().map_err(|_| "tmdb-image-invalid")?;
    let color = dominant_image_color(&bytes)?;
    let body = serde_json::to_string(&color).map_err(|_| "tmdb-cache-failed")?;
    cache(&app, &cache_key, &body, 30 * 24 * 60 * 60 * 1000)?;
    Ok(color)
}

#[tauri::command]
pub async fn get_tmdb_image_color(
    app: tauri::AppHandle,
    poster_path: String,
) -> Result<TmdbImageColor, String> {
    tauri::async_runtime::spawn_blocking(move || image_color_sync(app, poster_path))
        .await
        .map_err(|_| "tmdb-job-failed")?
}

fn image_palette_sync(
    app: tauri::AppHandle,
    poster_path: String,
) -> Result<TmdbImagePalette, String> {
    if !poster_path.starts_with('/') || poster_path.contains("..") || poster_path.len() > 240 {
        return Err("tmdb-image-path-invalid".into());
    }
    let cache_key = format!("palette-v2:{poster_path}");
    if let Some(body) = cached(&app, &cache_key)? {
        return serde_json::from_str(&body).map_err(|_| "tmdb-cache-failed".into());
    }
    let url = format!("https://image.tmdb.org/t/p/w154{poster_path}");
    let http = client()?;
    let response = send_with_retry(|| http.get(&url))?;
    if !response.status().is_success() {
        return Err(format!("tmdb-http-{}", response.status().as_u16()));
    }
    let bytes = response.bytes().map_err(|_| "tmdb-image-invalid")?;
    let palette = dominant_image_palette(&bytes)?;
    let body = serde_json::to_string(&palette).map_err(|_| "tmdb-cache-failed")?;
    cache(&app, &cache_key, &body, 30 * 24 * 60 * 60 * 1000)?;
    Ok(palette)
}

#[tauri::command]
pub async fn get_tmdb_image_palette(
    app: tauri::AppHandle,
    poster_path: String,
) -> Result<TmdbImagePalette, String> {
    tauri::async_runtime::spawn_blocking(move || image_palette_sync(app, poster_path))
        .await
        .map_err(|_| "tmdb-job-failed")?
}

fn season_sync(
    app: tauri::AppHandle,
    tmdb_id: u64,
    season: u16,
    language: String,
    refresh: bool,
) -> Result<Vec<TmdbEpisode>, String> {
    let token = crate::settings::api_key("tmdb")?;
    let endpoint = format!("{API_BASE}/tv/{tmdb_id}/season/{season}");
    let cache_key = format!("season:{tmdb_id}:{season}:{language}");
    let http = client()?;
    let value = read_json(&app, &cache_key, 7 * 24 * 60 * 60 * 1000, refresh, || {
        http.get(&endpoint)
            .bearer_auth(&token)
            .query(&[("language", language.as_str())])
    })?;
    let items = value
        .get("episodes")
        .and_then(Value::as_array)
        .ok_or("tmdb-response-invalid")?;
    Ok(items
        .iter()
        .filter_map(|item| {
            Some(TmdbEpisode {
                season: item.get("season_number")?.as_u64()? as u16,
                episode: item.get("episode_number")?.as_u64()? as u16,
                title: item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                overview: item
                    .get("overview")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                air_date: item
                    .get("air_date")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                still_path: item
                    .get("still_path")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                runtime: item
                    .get("runtime")
                    .and_then(Value::as_u64)
                    .map(|runtime| runtime as u16),
                vote_average: item
                    .get("vote_average")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn get_tmdb_season(
    app: tauri::AppHandle,
    tmdb_id: u64,
    season: u16,
    language: String,
    refresh: Option<bool>,
) -> Result<Vec<TmdbEpisode>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        season_sync(app, tmdb_id, season, language, refresh.unwrap_or(false))
    })
    .await
    .map_err(|_| "tmdb-job-failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_year() {
        assert_eq!(year(Some("2024-05-01")), Some(2024));
        assert_eq!(year(Some("")), None);
    }

    #[test]
    fn parses_tv_details_and_seasons() {
        let value = serde_json::json!({
            "id": 209867,
            "name": "Grand Blue",
            "original_name": "ぐらんぶる",
            "first_air_date": "2018-07-14",
            "overview": "A diving club comedy.",
            "poster_path": "/poster.jpg",
            "vote_average": 8.4,
            "vote_count": 1234,
            "status": "Ended",
            "original_language": "ja",
            "number_of_seasons": 1,
            "number_of_episodes": 12,
            "episode_run_time": [24],
            "genres": [{"name": "Animation"}, {"name": "Comedy"}],
            "seasons": [{
                "season_number": 1,
                "name": "Season 1",
                "overview": "",
                "air_date": "2018-07-14",
                "poster_path": "/season.jpg",
                "episode_count": 12
            }]
        });
        let details = parse_details(&value, "tv").expect("valid details");
        assert_eq!(details.title, "Grand Blue");
        assert_eq!(details.number_of_episodes, Some(12));
        assert_eq!(details.runtime, Some(24));
        assert_eq!(details.genres, vec!["Animation", "Comedy"]);
        assert_eq!(details.seasons[0].episode_count, 12);
    }

    #[test]
    fn dominant_color_prefers_saturated_pixels() {
        let mut image = image::RgbImage::new(10, 10);
        for (index, pixel) in image.pixels_mut().enumerate() {
            *pixel = if index < 75 {
                image::Rgb([20, 145, 225])
            } else {
                image::Rgb([220, 220, 220])
            };
        }
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("encode image");
        let color = dominant_image_color(encoded.get_ref()).expect("extract color");
        assert_eq!((color.red, color.green, color.blue), (20, 145, 225));
    }

    #[test]
    fn dominant_palette_returns_three_distinct_colors() {
        let mut image = image::RgbImage::new(90, 30);
        for (x, _y, pixel) in image.enumerate_pixels_mut() {
            *pixel = if x < 30 {
                image::Rgb([24, 142, 218])
            } else if x < 60 {
                image::Rgb([232, 168, 54])
            } else {
                image::Rgb([38, 84, 72])
            };
        }
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("encode image");

        let palette = dominant_image_palette(encoded.get_ref()).expect("extract palette");
        assert_eq!(palette.colors.len(), 3);
        assert!(palette
            .colors
            .windows(2)
            .all(|pair| pair[0].red != pair[1].red
                || pair[0].green != pair[1].green
                || pair[0].blue != pair[1].blue));
    }
}
