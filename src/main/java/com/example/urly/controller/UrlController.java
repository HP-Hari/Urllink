package com.example.urly.controller;

import com.example.urly.model.Click;
import com.example.urly.model.Url;
import com.example.urly.repository.ClickRepository;
import com.example.urly.repository.UrlRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@CrossOrigin(origins = "*")
public class UrlController {

    @Autowired
    private UrlRepository urlRepository;

    @Autowired
    private ClickRepository clickRepository;

    @Value("${app.base-url:http://localhost:8080}")
    private String baseUrl;

    private static final String CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @PostMapping("/api/shorten")
    public ResponseEntity<?> shortenUrl(@RequestBody ShortenRequest request) {
        String originalUrl = request.getOriginalUrl();
        if (originalUrl == null || originalUrl.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "URL cannot be empty"));
        }

        // Basic URL validation
        if (!originalUrl.startsWith("http://") && !originalUrl.startsWith("https://")) {
            originalUrl = "https://" + originalUrl;
        }

        String shortCode = request.getCustomCode();
        if (shortCode != null && !shortCode.trim().isEmpty()) {
            shortCode = shortCode.trim();
            if (shortCode.length() < 3 || shortCode.length() > 20) {
                return ResponseEntity.badRequest().body(Map.of("error", "Custom code must be between 3 and 20 characters"));
            }
            if (!shortCode.matches("^[a-zA-Z0-9_-]+$")) {
                return ResponseEntity.badRequest().body(Map.of("error", "Custom code can only contain alphanumeric characters, underscores, and hyphens"));
            }
            if (urlRepository.existsByShortCode(shortCode)) {
                return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Custom code is already in use"));
            }
        } else {
            // Generate unique short code
            int attempts = 0;
            do {
                shortCode = generateRandomCode(6);
                attempts++;
            } while (urlRepository.existsByShortCode(shortCode) && attempts < 10);

            if (attempts >= 10) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Failed to generate a unique short code, please try again"));
            }
        }

        Url url = Url.builder()
                .shortCode(shortCode)
                .originalUrl(originalUrl)
                .createdAt(LocalDateTime.now())
                .build();

        Url savedUrl = urlRepository.save(url);
        savedUrl.setShortUrl(baseUrl + "/" + savedUrl.getShortCode());
        return ResponseEntity.ok(savedUrl);
    }

    @GetMapping("/{code:[a-zA-Z0-9_-]{3,20}}")
    public RedirectView redirect(@PathVariable String code, HttpServletRequest request) {
        Optional<Url> urlOptional = urlRepository.findByShortCode(code);
        if (urlOptional.isPresent()) {
            Url url = urlOptional.get();

            // Log click async/background log
            String ipAddress = getClientIp(request);
            String userAgent = request.getHeader("User-Agent");

            Click click = Click.builder()
                    .urlId(url.getId())
                    .clickedAt(LocalDateTime.now())
                    .ipAddress(ipAddress)
                    .userAgent(userAgent)
                    .build();

            // Save click to database
            clickRepository.save(click);

            return new RedirectView(url.getOriginalUrl());
        } else {
            // Redirect to home if code not found
            return new RedirectView("/?error=notfound");
        }
    }

    @GetMapping("/api/stats/{code}")
    public ResponseEntity<?> getStats(@PathVariable String code) {
        Optional<Url> urlOptional = urlRepository.findByShortCode(code);
        if (urlOptional.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Url url = urlOptional.get();
        url.setShortUrl(baseUrl + "/" + url.getShortCode());
        long totalClicks = clickRepository.countByUrlId(url.getId());
        List<Click> recentClicks = clickRepository.findTop100ByUrlIdOrderByClickedAtDesc(url.getId());

        Map<String, Object> stats = new HashMap<>();
        stats.put("url", url);
        stats.put("totalClicks", totalClicks);
        stats.put("recentClicks", recentClicks);

        return ResponseEntity.ok(stats);
    }

    private String generateRandomCode(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(CHARACTERS.charAt(RANDOM.nextInt(CHARACTERS.length())));
        }
        return sb.toString();
    }

    private String getClientIp(HttpServletRequest request) {
        String ipAddress = request.getHeader("X-Forwarded-For");
        if (ipAddress == null || ipAddress.isEmpty() || "unknown".equalsIgnoreCase(ipAddress)) {
            ipAddress = request.getHeader("Proxy-Client-IP");
        }
        if (ipAddress == null || ipAddress.isEmpty() || "unknown".equalsIgnoreCase(ipAddress)) {
            ipAddress = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ipAddress == null || ipAddress.isEmpty() || "unknown".equalsIgnoreCase(ipAddress)) {
            ipAddress = request.getRemoteAddr();
        }
        // If multiple IPs are listed (comma separated), get the first one
        if (ipAddress != null && ipAddress.contains(",")) {
            ipAddress = ipAddress.split(",")[0].trim();
        }
        return ipAddress;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ShortenRequest {
        private String originalUrl;
        private String customCode;
    }
}
