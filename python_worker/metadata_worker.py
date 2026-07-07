import time
import sys
import os
import requests
from bs4 import BeautifulSoup
from pymongo import MongoClient
from urllib.parse import urljoin, urlparse

# MongoDB Connection — use env var for cloud, fallback to localhost for dev
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/urly")
DB_NAME = "urly"

print("Starting URL Metadata Scraper Worker...", flush=True)

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    # Trigger connection validation
    client.server_info()
    db = client[DB_NAME]
    urls_collection = db["urls"]
    print("Successfully connected to MongoDB.", flush=True)
except Exception as e:
    print(f"Error connecting to MongoDB: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

def get_domain(url):
    try:
        parsed = urlparse(url)
        return parsed.netloc or parsed.path
    except Exception:
        return "Unknown Website"

def scrape_metadata(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    domain = get_domain(url)
    fallback_title = domain
    fallback_desc = f"Preview metadata is not available for {domain}."
    fallback_favicon = f"https://www.google.com/s2/favicons?sz=64&domain={domain}"
    
    try:
        print(f"Fetching metadata for: {url}", flush=True)
        response = requests.get(url, headers=headers, timeout=5)
        
        if response.status_code != 200:
            print(f"Failed to fetch {url}, status code: {response.status_code}", flush=True)
            return fallback_title, fallback_desc, fallback_favicon
            
        soup = BeautifulSoup(response.text, "html.parser")
        
        # 1. Extract Title
        title_tag = soup.find("title")
        title = title_tag.string.strip() if title_tag and title_tag.string else ""
        if not title:
            # Try OpenGraph title
            og_title = soup.find("meta", property="og:title")
            title = og_title.get("content", "").strip() if og_title else ""
        if not title:
            title = fallback_title
            
        # 2. Extract Description
        desc = ""
        # Try meta description
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag:
            desc = desc_tag.get("content", "").strip()
        # Try og:description if meta description is empty
        if not desc:
            og_desc = soup.find("meta", property="og:description")
            if og_desc:
                desc = og_desc.get("content", "").strip()
        if not desc:
            desc = fallback_desc
            
        # 3. Extract Favicon
        favicon = ""
        for link in soup.find_all("link"):
            rel = [r.lower() for r in link.get("rel", [])]
            if any(r in ["icon", "shortcut icon", "apple-touch-icon"] for r in rel):
                href = link.get("href")
                if href:
                    favicon = urljoin(url, href)
                    break
        if not favicon:
            favicon = fallback_favicon
            
        # Limit lengths for layout styling safety
        if len(title) > 100:
            title = title[:97] + "..."
        if len(desc) > 200:
            desc = desc[:197] + "..."
            
        return title, desc, favicon
        
    except Exception as e:
        print(f"Exception while scraping {url}: {e}", flush=True)
        return fallback_title, fallback_desc, fallback_favicon

def run_worker():
    print("Polling MongoDB for new links without metadata...", flush=True)
    while True:
        try:
            # Find documents where title is missing (null, empty string, or field does not exist)
            query = {"$or": [{"title": None}, {"title": ""}, {"title": {"$exists": False}}]}
            pending_urls = list(urls_collection.find(query))
            
            if pending_urls:
                print(f"Found {len(pending_urls)} pending URL(s) to scrape.", flush=True)
                for doc in pending_urls:
                    url_id = doc["_id"]
                    original_url = doc.get("originalUrl")
                    
                    if not original_url:
                        continue
                        
                    title, desc, favicon = scrape_metadata(original_url)
                    
                    # Update document in MongoDB
                    urls_collection.update_one(
                        {"_id": url_id},
                        {
                            "$set": {
                                "title": title,
                                "description": desc,
                                "favicon": favicon
                            }
                        }
                    )
                    print(f"Updated URL metadata: {title}", flush=True)
            
        except Exception as e:
            print(f"Worker iteration exception: {e}", file=sys.stderr, flush=True)
            
        time.sleep(3)

if __name__ == "__main__":
    try:
        run_worker()
    except KeyboardInterrupt:
        print("\nStopping worker...", flush=True)
