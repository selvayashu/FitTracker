-- 0003_seed_activity_types.sql : MET values (Compendium of Physical Activities style)

insert into public.activity_types (id, name, met_light, met_moderate, met_vigorous, has_distance, sort_order) values
  (1,  'Walking',                  2.8,  3.5,  4.3, true,   1),
  (2,  'Brisk walking',            3.5,  4.3,  5.0, true,   2),
  (3,  'Running',                  7.0,  9.8, 11.5, true,   3),
  (4,  'Cycling',                  5.8,  8.0, 10.0, true,   4),
  (5,  'Swimming',                 5.8,  7.0,  9.8, true,   5),
  (6,  'Yoga',                     2.5,  3.0,  4.0, false,  6),
  (7,  'Gym / Strength training',  3.5,  5.0,  6.0, false,  7),
  (8,  'HIIT',                     6.0,  8.0, 10.0, false,  8),
  (9,  'Dance',                    4.5,  5.5,  7.8, false,  9),
  (10, 'Badminton',                4.5,  5.5,  7.0, false, 10),
  (11, 'Cricket',                  3.5,  4.8,  6.0, false, 11),
  (12, 'Football',                 7.0,  8.0, 10.0, true,  12),
  (13, 'Tennis',                   5.0,  7.3,  8.0, false, 13),
  (14, 'Skipping',                 8.0, 11.8, 12.3, false, 14),
  (15, 'Stair climbing',           4.0,  6.0,  8.8, false, 15),
  (16, 'Household chores',         2.5,  3.3,  4.0, false, 16),
  (17, 'Gardening',                2.3,  3.8,  5.0, false, 17),
  (18, 'Other',                    3.0,  4.0,  6.0, false, 18)
on conflict (id) do nothing;
