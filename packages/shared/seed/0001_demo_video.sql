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
  'VideoShare demo stream',
  'Seeded viewer slice used to prove D1 lookup and player rendering before admin publish exists.',
  null,
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  596,
  null,
  1749254400000,
  1749254400000
);

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
  'demo-video-0002',
  'private_Q2w9mNc4rTz8Lp1k',
  'Password protected demo',
  'Seeded local auth-flow video. Test password: opensesame.',
  null,
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  596,
  'd9fb92e3bbe65be1f1aad4a82eef4567f7a1ebe2cd110c8049b9698be7a70c88',
  1749254460000,
  1749254460000
);

INSERT OR IGNORE INTO chapters (
  id,
  video_id,
  title,
  start_sec,
  sort_order
) VALUES
  ('demo-chapter-0001', 'demo-video-0001', 'Intro', 0, 0),
  ('demo-chapter-0002', 'demo-video-0001', 'Middle', 180, 1),
  ('demo-chapter-0003', 'demo-video-0001', 'Wrap-up', 420, 2),
  ('demo-chapter-0004', 'demo-video-0002', 'Password prompt', 0, 0),
  ('demo-chapter-0005', 'demo-video-0002', 'Authorized playback', 210, 1),
  ('demo-chapter-0006', 'demo-video-0002', 'Final review', 460, 2);
