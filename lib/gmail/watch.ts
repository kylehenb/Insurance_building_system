import { getGmailClient } from './client'

const PUBSUB_TOPIC = 'projects/irc-master/topics/gmail-inbound'

export type WatchResult = {
  historyId: string
  expiration: string
}

export async function startGmailWatch(): Promise<WatchResult> {
  const gmail = getGmailClient()

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: PUBSUB_TOPIC,
      labelIds: ['INBOX'],
    },
  })

  if (!res.data.historyId || !res.data.expiration) {
    throw new Error('Gmail watch response missing historyId or expiration')
  }

  return {
    historyId: res.data.historyId,
    expiration: res.data.expiration,
  }
}

export async function stopGmailWatch(): Promise<void> {
  const gmail = getGmailClient()
  await gmail.users.stop({ userId: 'me' })
}
