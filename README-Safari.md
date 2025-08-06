# Converting to Safari App Extension for Mobile Safari

## Overview
This guide explains how to convert this Chrome extension to work with mobile Safari on iOS/iPadOS.

## Prerequisites
- Mac computer with Xcode 12.0 or later
- Apple Developer Account (free or paid)
- iOS device for testing

## Step 1: Create Safari App Extension in Xcode

1. **Open Xcode** and create a new project
2. **Choose "App"** under iOS
3. **Select "Safari App Extension"** template
4. **Name your project** (e.g., "Instagram Follow Requests")
5. **Choose your team** and bundle identifier

## Step 2: Convert Extension Files

### Content Script
The content script (`content-script.js`) needs minimal changes:

```javascript
// Remove Chrome-specific APIs
// Replace chrome.runtime.getURL with safari.extension.baseURI
// Update any Chrome extension specific code
```

### Manifest Conversion
Safari uses `Info.plist` instead of `manifest.json`. Create an `Info.plist` file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.Safari.extension</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).SafariExtensionHandler</string>
        <key>SFSafariContentScript</key>
        <array>
            <dict>
                <key>Script</key>
                <string>content-script.js</string>
            </dict>
        </array>
        <key>SFSafariStyleSheet</key>
        <array>
            <dict>
                <key>Style Sheet</key>
                <string>style.css</string>
            </dict>
        </array>
        <key>SFSafariWebsiteAccess</key>
        <dict>
            <key>Level</key>
            <string>All</string>
            <key>Allowed Domains</key>
            <array>
                <string>instagram.com</string>
                <string>*.instagram.com</string>
            </array>
        </dict>
    </dict>
</dict>
</plist>
```

## Step 3: Update Content Script for Safari

### Remove Chrome APIs
```javascript
// Remove this function entirely
function injectCSSIfNeeded() {
  // Safari handles CSS injection automatically via Info.plist
}
```

### Update API Calls
```javascript
// Replace chrome.runtime.getURL with safari.extension.baseURI
// Example:
const cssUrl = safari.extension.baseURI + 'style.css';
```

## Step 4: Build and Test

1. **Connect your iOS device** to your Mac
2. **Select your device** as the target in Xcode
3. **Build and run** the project
4. **On your iOS device**:
   - Go to Settings > Safari > Extensions
   - Enable your extension
   - Go to Safari and test on Instagram

## Step 5: Distribution

### For Personal Use
- Build directly to your device using Xcode
- Extension will work until you rebuild or update

### For App Store Distribution
- Requires paid Apple Developer Account
- Submit through App Store Connect
- Follow Apple's App Store guidelines

## Limitations of Mobile Safari Extensions

1. **No background scripts** - Content scripts only
2. **Limited API access** - No chrome.* APIs
3. **User must enable** - Extensions are off by default
4. **App Store requirement** - Must be distributed through App Store
5. **No popup pages** - Only content scripts and injected CSS

## Troubleshooting

### Extension Not Appearing
- Check Safari > Settings > Extensions
- Ensure extension is enabled
- Verify website access permissions

### Content Script Not Loading
- Check Info.plist configuration
- Verify script file is included in bundle
- Check Safari console for errors

### API Calls Failing
- Ensure proper CORS headers
- Check network permissions
- Verify Instagram API endpoints

## Alternative Approach: Web App

If Safari extension limitations are too restrictive, consider creating a web app that users can add to their home screen:

1. **Create a web interface** for managing follow requests
2. **Use Instagram's web API** directly
3. **Add to home screen** functionality
4. **Progressive Web App** features

This approach avoids App Store requirements and extension limitations. 