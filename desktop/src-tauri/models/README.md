# Offline face detector

`seeta_fd_frontal_v1.0.bin` is the unmodified SeetaFace detector model distributed
by rustface at commit `fa3d5b5d576c91d1c8a099af381e0f0906a0d3a3`:

https://github.com/atomashpolskiy/rustface/tree/fa3d5b5d576c91d1c8a099af381e0f0906a0d3a3/model

The upstream BSD-2-Clause copyright and license are included in `LICENSE`.
The model is embedded in macOS and Linux builds; Windows uses its native
offline face detector. Neither implementation downloads models at runtime.
