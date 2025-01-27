> R2Uploader is currently in its beta phase and may encounter glitches or malfunctions. Users should be aware that the system is still under development and may not operate flawlessly. It is advisable to proceed with caution and report any issues to the support team for resolution.

# R2Uploader

User-friendly GUI application for Cloudflare R2.

## Table of Contents

1. [About](#about)
2. [Why Cloudflare R2](#why-cloudflare-r2)
3. [Screenshots](#screenshots)
4. [Download](#download)
5. [Tutorial](#tutorial)
6. [Contact](#contact)
7. [License](#license)

## About

R2Uploader is an open-source application designed to streamline the upload and management of [Cloudflare R2](https://www.cloudflare.com/developer-platform/products/r2/) objects.

R2Uploader aims to simplify the process of uploading and sharing R2 objects, serving as your R2 asset management assistant. The primary goal of this app is to provide convenience for non-technical users, so the UI was designed with simplicity and ease of use in mind.

---

<div style="display:flex; align-items: center;">
  <div style="flex:1">
  <h3>
  Browse objects using the Masonry layout</h3>

  R2uploader supports real-time preview of objects using the Masonry layout, making the process more convenient and intuitive. The dynamic grid display enhances the user experience, allowing for efficient browsing and management of uploaded content.
  </div>

  <div style="flex:1">
    <img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/r2-uploader-objects.png" style="width: 90%" />
  </div>

</div>

<div style="display:flex; align-items: center;">
  <div style="flex:1">
    <img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250127-phel.png" style="width: 90%" />
  </div>
  <div style="flex:1">
  <h3>
 Super Right-Click</h3>

"Super Right-Click" offers easier management for each object: file export, object deletion, copy shareable link, copy to clipboard, and more. Dive in and explore the full range of features!
  </div>

</div>

<div style="display:flex; align-items: center;">
  <div style="flex:1">
  <h3>
  Support Search</h3>

  R2uploader supports search functionality to find specific objects based on prefix.
  </div>

  <div style="flex:1">
    <img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250127-pial.png" style="width: 90%" />
  </div>

</div>


## RoadMap

- <del>**Search Functionality**</del>
- <del>**Image Export and Copy**: Enable users to export and copy images to clipboard seamlessly for better usability </del>
- **Custom Domain Integration**
- **Filter by created time**:  Introduce filtering options by creation time to streamline content organization
- **Automatically download small objects to the computer**: Automate the download process for small files to improve efficiency and provide a fallback option in case of accidental deletion
- **Support directories**
- **Automatic Updates**

## Why Cloudflare R2

https://ysrazsingh.medium.com/how-cloudflare-r2-makes-my-life-easy-fb0fd453fff0

## Screenshots

<div style="text-align: center">
<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/r2-uploader-screenshot.png" style="width: 90%;" />

<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/r2-uploader-objects.png" style="width: 90%;display: inline-block;margin-top: 10px;" />

<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250118-kdgo.png" style="width: 90%;display: inline-block;margin-top: 10px;" />

</div>


## Download

For macOS ARM64: [Download DMG](https://github.com/maoxiaoke/r2Uploader/releases/latest/download/R2Uploader-0.0.1-beta.1-arm64.dmg)

For macOS Intel: [Download DMG](https://github.com/maoxiaoke/r2Uploader/releases/latest/download/R2Uploader-0.0.1-beta.1.dmg)

For Win: [Download EXE](https://github.com/maoxiaoke/r2Uploader/releases/latest/download/R2Uploader.Setup.0.0.1-beta.1.exe)

## Tutorial

## How to get Cloudflare's account id and R2 token

1. When you log in to the [Cloudflare dashboard](https://dash.cloudflare.com/), the account ID is displayed in the browser's address bar.

<div style="text-align: center">
<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250118-knlp.png" style="width: 90%;" />

</div>


2. On the R2 homepage, select "**Manage API Tokens**".

<div style="text-align: center">
<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250118-kqky.png" style="width: 90%;" />


</div>

3. Then, click on "Create API Token".

<div style="text-align: center">
<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250118-krkr.png" style="width: 90%;" />


</div>

Please ensure that you name your API token in a manner that is relevant to the service that will utilize it. Grant it "**Admin Read & Write**" and Write" permissions for objects, and we recommend applying it solely to a single bucket.

You may leave the remaining settings (TTL, Client IP Address Filtering) unchanged, and then proceed to click on "**Create API Token**".

4. Upon successful creation of the token, make sure to copy your Token Value.

<div style="text-align: center">
<img src="https://pub-388464a2ac764e37ba36c5ea17d573ee.r2.dev/SCR-20250118-krpl.png" style="width: 90%;" />


</div>


> The token will be stored locally and will not be publicly uploaded.

## How to activate your license

After [purchasing the app](https://anotherme.lemonsqueezy.com/buy/f9d4edca-2436-4247-a567-9002fb95a8e8), you will receive a receipt with the license key sent to your email. If you can't find the email, follow these steps to locate your license key.

1. Go to https://app.lemonsqueezy.com/my-orders/
2. Find your R2Uploader order
3. Your license key is on your right

> We require you to provide a license key, but you can still use it for free.


## Contact

If you have any questions, feel free to e-mail me: [maoxiaoke@outlook.com](mailto:maoxiaoke@outlook.com)

Or join the my telegram group：[nazha's land](https://t.me/+m3vKoZMPtoE5NDc1)

Or find my on X/Twitter: [xiaokedada](https://x.com/xiaokedada)


## License

R2Uploader is licensed under the [GPL v3.0](https://choosealicense.com/licenses/gpl-3.0/) License. See [LICENSE](LICENSE.txt) for more details.
