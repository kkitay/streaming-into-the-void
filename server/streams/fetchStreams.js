import request from 'request-promise-native';
import db from '../db';
import refreshAccessToken from './refreshAccessToken';
import Config from '../config.json';

const GAME_IDS = [
  509658,
  // 26936, music category. too many boring streams
  509660,
  417752,
  509659,
  509670,
  518203,
  509673,
  509667,
  509672,
  509663,
  509669,
  515214,
  509671,
];

const addVoid = async (client, stream) => {
  const queryText =
    'INSERT INTO voids ( \
    stream_id, \
    type, \
    last_live_at, \
    user_id, \
    title, \
    language, \
    thumbnail_url, \
    viewers \
  ) VALUES ($1, $2, current_timestamp, $3, $4, $5, $6, $7) \
  ON CONFLICT (stream_id) DO UPDATE SET last_live_at = current_timestamp \
  RETURNING *';

  const queryParams = [
    stream.id,
    'stream',
    stream.user_id,
    stream.title,
    stream.language,
    stream.thumbnail_url,
    stream.viewer_count,
  ];

  try {
    await client.query(queryText, queryParams);
    return true;
  } catch (e) {
    console.log('Error saving stream to db', e);
    return false;
  }
};

// make one call and receive up to 100 streams from Twitch API
// returns json.data (streams)
// returns json.pagination (new cursor)
const fetchStreams = async (cursor, token) => {
  // set up call
  if (!token) {
      token = await refreshAccessToken();
  }
  let options = {
    uri:
      'https://api.twitch.tv/helix/streams?first=100&language=en&after=' +
      (cursor ? cursor : '') +
      '&game_id=' +
      GAME_IDS.join('&game_id='),
    headers: {
      'client-id': Config.twitch_secrets.client_id,
      Authorization: 'Bearer ' + token,
    },
    json: true,
  };
  // fetch and return data
  try {
    const response = await request(options);
    return response;
  } catch (e) {
    console.error(
      '==> Could not fetch streams at cursor:\n',
      cursor,
      '\nwith token:\n',
      token,
      '\nerror:\n',
      e.message
    );
    return e;
  }
};

const filterStreams = async (streams) => {
  const client = await db.pool.connect();
  let count = 0;

  await Promise.all(
    streams.map(async (stream) => {
      if (stream && stream.viewer_count < 2 && stream.type === 'live') {
        // add stream to db
        await addVoid(client, stream);
        count++;
      }
    })
  );

  client.release();
  return count;
};

// grab many streams in a batch of up to 120 calls.
export default async (token, cursor) => {
  let batchSize = 120;

  let stats = {
    began: Date.now(),
    calls: 0,
    voids: 0,
  };

  try {
    for (let i = 0; i < batchSize; i++) {
      // grab streams.
      let streams = await fetchStreams(cursor, token);

      // check for error object
      if (streams.error) {
        if (streams.error.status === 401) {
          // updates the local config files and returns the access_token
          token = await refreshAccessToken();
        } else {
          console.error(
            `==> Bad response received (${streams.error.status}): ${streams.error.error}`
          );
        }
        break;
      }

      // filter streams
      stats.voids = await filterStreams(streams.data);

      // update the cursor
      cursor = streams.data.length > 0 ? streams.pagination.cursor : null;

      stats.calls++;
    }
  } catch (e) {
    console.error('==> Fetching streams failed', cursor, e);
  } finally {
    console.log(
      `==> Finished batch.\n${stats.voids} voids\n${stats.calls} calls`
    );

    return { cursor, token };
  }
};
