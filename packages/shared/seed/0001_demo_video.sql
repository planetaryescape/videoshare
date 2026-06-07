INSERT OR IGNORE INTO videos (
  id,
  slug,
  title,
  description,
  poster_key,
  hls_key,
  duration_sec,
  password_hash,
  created_at,
  published_at
) VALUES (
  'demo-video-0001',
  'demo_7yQn3rLp9Ks4Vm2x',
  'VideoShare demo',
  'First video published through the live stack. Transferred from demo.mov with poster extraction and HLS transcoding.',
  'https://video.planetaryescape.co.za/videos/demo/poster.jpg',
  'https://video.planetaryescape.co.za/videos/demo/master.m3u8',
  6.4,
  null,
  1749254400000,
  1749254400000
);

INSERT OR IGNORE INTO chapters (
  id,
  video_id,
  title,
  start_sec,
  sort_order
) VALUES
  ('demo-chapter-0001', 'demo-video-0001', 'Intro', 0, 0),
  ('demo-chapter-0002', 'demo-video-0001', 'Main', 2, 1),
  ('demo-chapter-0003', 'demo-video-0001', 'End', 4, 2);
