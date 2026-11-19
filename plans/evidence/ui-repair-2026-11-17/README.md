# Grace release and native Glass checks — November 17, 2026

Mozilla returned signed, unlisted Firefox companion 1.1.4. The repository verifier matched the signed archive to the current Firefox manifest and shared source, including the Grace logo on the consent page. Both local release builds embedded the same signed XPI.

| Artifact | SHA-256 |
| --- | --- |
| Firefox 1.1.4 XPI | `dc1c123567d898f998d46ce025f1a3782aeb74770384172e9a696b0de3b88cdb` |
| macOS ARM64 DMG | `f84980fa942851ae58faf53c6efccb73df6eef061f87e6b694df0f0ab655032a` |
| macOS executable tested | `9c3c7aff95e1c0d5d3f7a79be0cca8cab6d941c7a8421a92b92999ba1631ff77` |
| Linux ARM64 DEB | `f7bcb11b9ae9fa837b68d6f9730394eb69e38160739763d59ce70875380c2a34` |
| Linux executable tested | `600281600771b9f5f144c7ca4c22c5f415bede7555854349eeb83510c88149fc` |

- **macOS 15.7.7 ARM64.** The packaged app reported Glass installed and active. With City Lights at 100% transparency, the four duration values appeared directly on the settings surface over a patterned backdrop. The native accessibility tree exposed four named sliders. The Notifications volume slider showed its fill and keyboard focus, and Home, End, and Left Arrow changes saved 0%, 100%, and 90%. The timer popover stayed visible after moving the pointer from Mute onto Volume. [Durations](macos-duration.png) · [Volume](macos-volume.png) · [Timer popover](macos-timer-footer.png)
- **Ubuntu 24.04 ARM64, XFCE/WebKitGTK.** The app extracted from the DEB reported Glass selected and native material inactive. The opaque fallback showed plain duration values and a visible volume fill, track and focus ring. Native keyboard and pointer input saved 0%, 50%, 90%, and 100%. The timer volume popover remained visible with the pointer over its slider. [Durations](linux-duration.png) · [Volume](linux-volume.png) · [Timer popover](linux-timer-footer.png)
- **Authorization page.** The built companion rendered the bundled logo, Disconnected status, and both consent actions in a fresh Chrome profile. Advanced pairing stayed hidden. Firefox and Chrome share this authorization page. [Authorization screenshot](companion-authorization.png)

The macOS build produced an app and DMG, and `hdiutil verify` validated the DMG checksum. The Linux build produced a DEB. `npm run check` reported zero errors and warnings. The full test rerun passed 176 tests with two opt-in capture skips. The initial full run had a Blocky fixture timeout that resolved on the rerun. The two disposable guests were stopped. VoiceOver was removed from this check at the user’s request.
