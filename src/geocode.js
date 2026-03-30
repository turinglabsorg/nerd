import { posts } from "./db.js";

const UA = "nerd-agent/1.0";
const GEOCODE_DELAY = 1100; // Nominatim asks for 1 req/sec

// Common location patterns in UFO post titles
const LOCATION_PATTERNS = [
  // "City, State/Country" or "City State"
  /(?:over|in|from|near|above)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:,?\s+[A-Z]{2,})?)/,
  // "Location YYYY" or "Location MM/YYYY"
  /^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:,?\s+[A-Z][a-z]+)*)\s+\d{2}\/?\d{2,4}/,
  // Explicit country/city names
  /\b(Argentina|Brazil|Mexico|Chile|Turkey|Iran|Japan|Australia|Canada|UK|India|China|Russia|Colombia|Peru|Spain|Italy|France|Germany|Netherlands|Belgium|Portugal|Israel|Egypt|South Africa)\b/i,
  /\b(NYC|New York|Los Angeles|Houston|Phoenix|Chicago|San Francisco|Las Vegas|Miami|Seattle|Denver|Dallas|Atlanta|Boston|Portland|Bogota|Guadalajara|São Paulo|Buenos Aires|Lima|Santiago|London|Paris|Berlin|Tokyo|Sydney|Melbourne|Mumbai|Delhi|Beijing|Shanghai|Moscow|Cairo|Istanbul|Barrie|Ontario|Quebec|Alberta)\b/i,
];

function extractLocation(title, body) {
  const text = `${title} ${body || ""}`;

  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

async function geocodeLocation(location) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
    });

    if (!res.ok) return null;

    const results = await res.json();
    if (results.length === 0) return null;

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
      displayName: results[0].display_name,
      query: location,
    };
  } catch (err) {
    console.error(`[geocode] error for "${location}":`, err.message);
    return null;
  }
}

export async function geocodePosts() {
  const pending = await posts()
    .find({ geo: { $exists: false } })
    .sort({ insertedAt: -1 })
    .limit(15)
    .toArray();

  if (pending.length === 0) {
    console.log("[geocode] no pending posts");
    return 0;
  }

  let geocoded = 0;

  for (const post of pending) {
    const location = extractLocation(post.title, post.selftext);

    if (!location) {
      // Mark as processed with no geo
      await posts().updateOne({ _id: post._id }, { $set: { geo: null } });
      continue;
    }

    const geo = await geocodeLocation(location);

    if (geo) {
      await posts().updateOne({ _id: post._id }, { $set: { geo } });
      console.log(`[geocode] ${post.redditId}: "${location}" → ${geo.lat}, ${geo.lng}`);
      geocoded++;
    } else {
      await posts().updateOne({ _id: post._id }, { $set: { geo: null } });
    }

    // Rate limit for Nominatim
    await new Promise((r) => setTimeout(r, GEOCODE_DELAY));
  }

  return geocoded;
}
