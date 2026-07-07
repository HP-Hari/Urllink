// Global state
let clicksChart = null;

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const shortenForm = document.getElementById("shorten-form");
    const longUrlInput = document.getElementById("long-url");
    const customCodeInput = document.getElementById("custom-code");
    const submitBtn = document.getElementById("submit-btn");
    
    const resultCard = document.getElementById("result-card");
    const shortUrlDisplay = document.getElementById("short-url-display");
    const copyBtn = document.getElementById("copy-btn");
    const closeResultBtn = document.getElementById("close-result");
    
    const previewLoader = document.getElementById("preview-loader");
    const previewCard = document.getElementById("preview-card");
    const previewFavicon = document.getElementById("preview-favicon");
    const previewDomain = document.getElementById("preview-domain");
    const previewTitle = document.getElementById("preview-title");
    const previewDesc = document.getElementById("preview-desc");
    
    const qrCodeImg = document.getElementById("qr-code-img");
    const downloadQrLink = document.getElementById("download-qr");
    
    const historyList = document.getElementById("history-list");
    const emptyHistory = document.getElementById("empty-history");
    const clearHistoryBtn = document.getElementById("clear-history-btn");
    
    const statsModal = document.getElementById("stats-modal");
    const closeModalBtn = document.getElementById("close-modal");
    const modalShortUrl = document.getElementById("modal-short-url");
    const statTotalClicks = document.getElementById("stat-total-clicks");
    const statOriginalUrl = document.getElementById("stat-original-url");
    
    const modalFavicon = document.getElementById("modal-favicon");
    const modalDomain = document.getElementById("modal-domain");
    const modalTitle = document.getElementById("modal-title");
    const modalDesc = document.getElementById("modal-desc");
    const clicksLogTbody = document.getElementById("clicks-log-tbody");
    
    const toast = document.getElementById("toast");
    const toastText = document.getElementById("toast-text");

    // Initialize History
    renderHistory();

    // 1. Shorten Form Submission
    shortenForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const originalUrl = longUrlInput.value.trim();
        const customCode = customCodeInput.value.trim();
        
        // Disable UI
        setLoadingState(true);
        
        try {
            const response = await fetch("/api/shorten", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    originalUrl: originalUrl,
                    customCode: customCode || null
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || "An error occurred while shortening the URL.");
            }
            
            // Success - Process short URL
            const shortCode = data.shortCode;
            const shortUrl = data.shortUrl || `${window.location.origin}/${shortCode}`;
            
            // Show result card
            shortUrlDisplay.textContent = shortUrl;
            resultCard.classList.remove("hidden");
            
            // Configure QR Code
            const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(shortUrl)}`;
            qrCodeImg.src = qrApiUrl;
            downloadQrLink.href = qrApiUrl;
            downloadQrLink.target = "_blank";
            
            // Poll for metadata updates from Python worker
            startMetadataPolling(shortCode);
            
            // Save to local history
            saveToHistory({
                shortCode: shortCode,
                shortUrl: shortUrl,
                originalUrl: data.originalUrl,
                title: data.title || null,
                favicon: data.favicon || null,
                createdAt: data.createdAt
            });
            
            // Clear inputs
            longUrlInput.value = "";
            customCodeInput.value = "";
            
            showToast("Short link generated successfully!");
            
        } catch (err) {
            showToast(err.message, true);
        } finally {
            setLoadingState(false);
        }
    });

    // 2. Clipboard Copy Operations
    copyBtn.addEventListener("click", () => {
        const urlText = shortUrlDisplay.textContent;
        copyToClipboard(urlText);
    });

    closeResultBtn.addEventListener("click", () => {
        resultCard.classList.add("hidden");
    });

    // 3. Clear History Action
    clearHistoryBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to clear your local shortening history?")) {
            localStorage.removeItem("urly_history");
            renderHistory();
            showToast("History cleared.");
        }
    });

    // 4. Modal Close Operations
    closeModalBtn.addEventListener("click", () => {
        statsModal.classList.add("hidden");
    });
    
    // Close modal if clicked outside modal-card
    statsModal.addEventListener("click", (e) => {
        if (e.target === statsModal) {
            statsModal.classList.add("hidden");
        }
    });

    // --- Core Functions ---

    function setLoadingState(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            submitBtn.querySelector(".btn-text").textContent = "Creating link...";
            submitBtn.querySelector(".btn-icon i").className = "fa-solid fa-circle-notch fa-spin";
        } else {
            submitBtn.disabled = false;
            submitBtn.querySelector(".btn-text").textContent = "Shorten Link";
            submitBtn.querySelector(".btn-icon i").className = "fa-solid fa-arrow-right";
        }
    }

    function showToast(message, isError = false) {
        toastText.textContent = message;
        
        const icon = toast.querySelector("i");
        if (isError) {
            toast.style.borderColor = "var(--error)";
            toast.style.boxShadow = "0 4px 20px rgba(239, 68, 68, 0.3)";
            icon.className = "fa-solid fa-circle-exclamation text-danger";
            icon.style.color = "var(--error)";
        } else {
            toast.style.borderColor = "var(--color-primary)";
            toast.style.boxShadow = "0 4px 20px rgba(99, 102, 241, 0.3)";
            icon.className = "fa-solid fa-circle-info";
            icon.style.color = "var(--color-primary)";
        }
        
        toast.classList.remove("hidden");
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add("hidden");
        }, 3000);
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast("Copied to clipboard!");
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showToast("Copied to clipboard!");
            } catch (err2) {
                showToast("Failed to copy link.", true);
            }
            document.body.removeChild(textArea);
        }
    }

    // 5. Poller for Asynchronous Metadata fetching
    function startMetadataPolling(shortCode) {
        // Show loader, hide preview card
        previewLoader.classList.remove("hidden");
        previewCard.classList.add("hidden");
        
        let attempts = 0;
        const maxAttempts = 8;
        
        const pollInterval = setInterval(async () => {
            attempts++;
            try {
                const response = await fetch(`/api/stats/${shortCode}`);
                if (!response.ok) return;
                
                const data = await response.json();
                const urlInfo = data.url;
                
                // If title is scraped and filled
                if (urlInfo && urlInfo.title) {
                    clearInterval(pollInterval);
                    updatePreviewUI(urlInfo);
                    
                    // Update the localStorage copy with fetched title/favicon
                    updateHistoryItem(shortCode, urlInfo.title, urlInfo.favicon, urlInfo.description);
                }
            } catch (err) {
                console.error("Error polling metadata:", err);
            }
            
            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                // Stopped polling, show placeholder or domain
                previewLoader.classList.add("hidden");
                previewCard.classList.remove("hidden");
            }
        }, 1500);
    }

    function updatePreviewUI(urlInfo) {
        previewLoader.classList.add("hidden");
        previewCard.classList.remove("hidden");
        
        const parsedUrl = new URL(urlInfo.originalUrl);
        previewDomain.textContent = parsedUrl.hostname;
        
        previewTitle.textContent = urlInfo.title || parsedUrl.hostname;
        previewDesc.textContent = urlInfo.description || "No preview description available.";
        
        if (urlInfo.favicon) {
            previewFavicon.src = urlInfo.favicon;
        } else {
            previewFavicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${parsedUrl.hostname}`;
        }
    }

    // --- Local Storage History ---
    
    function getHistory() {
        const historyJson = localStorage.getItem("urly_history");
        return historyJson ? JSON.parse(historyJson) : [];
    }

    function saveToHistory(item) {
        const history = getHistory();
        // Remove existing if duplicate
        const filtered = history.filter(h => h.shortCode !== item.shortCode);
        filtered.unshift(item); // Add to beginning
        // Limit history to 20 items
        if (filtered.length > 20) {
            filtered.pop();
        }
        localStorage.setItem("urly_history", JSON.stringify(filtered));
        renderHistory();
    }

    function updateHistoryItem(shortCode, title, favicon, description) {
        const history = getHistory();
        const index = history.findIndex(h => h.shortCode === shortCode);
        if (index !== -1) {
            history[index].title = title;
            history[index].favicon = favicon;
            history[index].description = description;
            localStorage.setItem("urly_history", JSON.stringify(history));
            renderHistory();
        }
    }

    function renderHistory() {
        const history = getHistory();
        
        if (history.length === 0) {
            emptyHistory.classList.remove("hidden");
            historyList.classList.add("hidden");
            clearHistoryBtn.classList.add("hidden");
            return;
        }
        
        emptyHistory.classList.add("hidden");
        historyList.classList.remove("hidden");
        clearHistoryBtn.classList.remove("hidden");
        
        historyList.innerHTML = "";
        
        history.forEach(item => {
            const itemEl = document.createElement("div");
            itemEl.className = "history-item";
            
            const shortUrl = item.shortUrl || `${window.location.origin}/${item.shortCode}`;
            const displayShortUrl = shortUrl.replace(/^https?:\/\//, '');
            
            // Build favicon src
            let faviconSrc = "";
            if (item.favicon) {
                faviconSrc = item.favicon;
            } else {
                try {
                    const parsed = new URL(item.originalUrl);
                    faviconSrc = `https://www.google.com/s2/favicons?sz=64&domain=${parsed.hostname}`;
                } catch {
                    faviconSrc = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='%236366f1'/></svg>";
                }
            }

            const titleText = item.title || item.originalUrl;
            
            itemEl.innerHTML = `
                <div class="history-details">
                    <div class="history-favicon">
                        <img src="${faviconSrc}" alt="icon" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'16\\' height=\\'16\\'><rect width=\\'16\\' height=\\'16\\' fill=\\'%236366f1\\'/></svg>'">
                    </div>
                    <div class="history-info">
                        <a href="${shortUrl}" target="_blank" class="history-short-url">${displayShortUrl}</a>
                        <span class="history-long-url" title="${item.originalUrl}">${item.originalUrl}</span>
                    </div>
                </div>
                <div class="history-actions">
                    <div class="click-counter" data-code="${item.shortCode}">
                        <i class="fa-solid fa-chart-simple"></i> <span class="click-val">...</span> <span class="click-label">clicks</span>
                    </div>
                    <button class="mini-btn copy-history-btn" data-url="${shortUrl}" title="Copy Link">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                    <button class="mini-btn stats-trigger" data-code="${item.shortCode}" title="Detailed Stats">
                        <i class="fa-solid fa-chart-line"></i>
                    </button>
                </div>
            `;
            
            historyList.appendChild(itemEl);
        });

        // Add Event Listeners for actions in list
        document.querySelectorAll(".copy-history-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const url = btn.getAttribute("data-url");
                copyToClipboard(url);
            });
        });

        document.querySelectorAll(".stats-trigger").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const code = btn.getAttribute("data-code");
                openStatsModal(code);
            });
        });

        // Background update click counts
        history.forEach(item => {
            fetchClickCountBackground(item.shortCode);
        });
    }

    async function fetchClickCountBackground(shortCode) {
        try {
            const response = await fetch(`/api/stats/${shortCode}`);
            if (!response.ok) {
                // Short code doesn't exist on server (stale localStorage entry)
                if (response.status === 404) {
                    removeFromHistory(shortCode);
                }
                return;
            }
            const data = await response.json();
            
            const counterEl = document.querySelector(`.click-counter[data-code="${shortCode}"] .click-val`);
            const labelEl = document.querySelector(`.click-counter[data-code="${shortCode}"] .click-label`);
            if (counterEl) {
                counterEl.textContent = data.totalClicks;
            }
            if (labelEl) {
                labelEl.textContent = data.totalClicks === 1 ? 'click' : 'clicks';
            }
            
            // If the item had no title, but it has one now (fetched by Python in backend)
            // Update local storage
            if (data.url && data.url.title) {
                const history = getHistory();
                const histItem = history.find(h => h.shortCode === shortCode);
                if (histItem && !histItem.title) {
                    updateHistoryItem(shortCode, data.url.title, data.url.favicon, data.url.description);
                }
            }
        } catch (err) {
            console.error("Error fetching click count background:", err);
        }
    }

    function removeFromHistory(shortCode) {
        const history = getHistory();
        const filtered = history.filter(h => h.shortCode !== shortCode);
        if (filtered.length !== history.length) {
            localStorage.setItem("urly_history", JSON.stringify(filtered));
            // Defer re-render to avoid mutating DOM during iteration
            setTimeout(() => renderHistory(), 0);
        }
    }

    // --- Statistics Modal Operations & Charting ---

    async function openStatsModal(shortCode) {
        statsModal.classList.remove("hidden");
        
        // Reset Modal content with placeholder
        modalShortUrl.textContent = `Loading...`;
        modalShortUrl.href = "#";
        statTotalClicks.textContent = "...";
        statOriginalUrl.textContent = "Loading...";
        statOriginalUrl.href = "#";
        modalTitle.textContent = "Loading preview...";
        modalDesc.textContent = "Description...";
        modalDomain.textContent = "";
        modalFavicon.src = "";
        clicksLogTbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">Loading clicks...</td></tr>';
        
        try {
            const response = await fetch(`/api/stats/${shortCode}`);
            if (!response.ok) {
                throw new Error("Stats not found");
            }
            const data = await response.json();
            
            // Fill core info
            statTotalClicks.textContent = data.totalClicks;
            statOriginalUrl.textContent = data.url.originalUrl;
            statOriginalUrl.href = data.url.originalUrl;
            
            const serverShortUrl = data.url.shortUrl || `${window.location.origin}/${shortCode}`;
            modalShortUrl.textContent = serverShortUrl.replace(/^https?:\/\//, '');
            modalShortUrl.href = serverShortUrl;
            
            // Metadata card
            const parsedUrl = new URL(data.url.originalUrl);
            modalDomain.textContent = parsedUrl.hostname;
            modalTitle.textContent = data.url.title || parsedUrl.hostname;
            modalDesc.textContent = data.url.description || "Metadata is not populated yet.";
            
            if (data.url.favicon) {
                modalFavicon.src = data.url.favicon;
            } else {
                modalFavicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${parsedUrl.hostname}`;
            }

            // Fill Clicks Log
            renderClicksLog(data.recentClicks);
            
            // Build Chart
            renderChart(data.recentClicks);

        } catch (err) {
            showToast("Failed to load statistics.", true);
            statsModal.classList.add("hidden");
        }
    }

    function renderClicksLog(clicks) {
        if (!clicks || clicks.length === 0) {
            clicksLogTbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No clicks registered yet.</td></tr>';
            return;
        }
        
        clicksLogTbody.innerHTML = "";
        clicks.forEach(click => {
            const tr = document.createElement("tr");
            
            // Format Timestamp
            const clickedDate = new Date(click.clickedAt);
            const dateStr = clickedDate.toLocaleString();
            
            // User Agent Parser (Simple)
            let device = "Unknown Browser";
            const ua = click.userAgent || "";
            if (ua.includes("Mobile") || ua.includes("Android") || ua.includes("iPhone")) {
                device = "Mobile Device";
                if (ua.includes("Safari") && !ua.includes("Chrome")) device = "Safari (iOS)";
                if (ua.includes("Chrome")) device = "Chrome (Mobile)";
            } else {
                if (ua.includes("Firefox")) device = "Firefox (Desktop)";
                else if (ua.includes("Chrome")) device = "Chrome (Desktop)";
                else if (ua.includes("Safari")) device = "Safari (Desktop)";
                else if (ua.includes("Edge")) device = "Edge (Desktop)";
            }

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><code style="color: #c084fc;">${click.ipAddress || 'unknown'}</code></td>
                <td><span title="${ua}">${device}</span></td>
            `;
            clicksLogTbody.appendChild(tr);
        });
    }

    function renderChart(clicks) {
        const ctx = document.getElementById("clicks-chart").getContext("2d");
        
        // Destroy old instance if exists
        if (clicksChart) {
            clicksChart.destroy();
        }
        
        // Group clicks by past 7 days
        const last7Days = [];
        const labelDates = [];
        
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
            last7Days.push({
                dateStr: dateStr,
                label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                count: 0
            });
        }
        
        // Map clicks to the dates
        if (clicks) {
            clicks.forEach(click => {
                const clickDateStr = click.clickedAt.split("T")[0];
                const targetDay = last7Days.find(day => day.dateStr === clickDateStr);
                if (targetDay) {
                    targetDay.count++;
                }
            });
        }
        
        const labels = last7Days.map(day => day.label);
        const counts = last7Days.map(day => day.count);
        
        // Create premium design chart (gradients)
        const gradient = ctx.createLinearGradient(0, 0, 0, 160);
        gradient.addColorStop(0, "rgba(236, 72, 153, 0.4)");
        gradient.addColorStop(1, "rgba(99, 102, 241, 0.0)");

        clicksChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Clicks',
                    data: counts,
                    borderColor: '#ec4899',
                    borderWidth: 3,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#ffffff',
                    pointHoverRadius: 6,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#9ca3af',
                            font: {
                                family: 'Outfit'
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#9ca3af',
                            stepSize: 1,
                            font: {
                                family: 'Outfit'
                            }
                        }
                    }
                }
            }
        });
    }
});
