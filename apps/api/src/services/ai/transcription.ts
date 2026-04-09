import OpenAI from 'openai'
import { logger } from '../../lib/logger'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Download a WhatsApp media file and transcribe it using Whisper.
 * @param mediaId - WhatsApp media ID from the webhook payload
 * @param accessToken - Tenant's WhatsApp access token (decrypted)
 * @returns Transcription text, or null if transcription fails
 */
export async function transcribeWhatsAppAudio(
  mediaId: string,
  accessToken: string
): Promise<string | null> {
  try {
    // Step 1: Get media URL from WhatsApp API
    const mediaResp = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!mediaResp.ok) {
      logger.warn({ mediaId }, '[transcription] Failed to get media URL')
      return null
    }
    const mediaData = await mediaResp.json() as { url: string }

    // Step 2: Download the audio file
    const audioResp = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!audioResp.ok) return null

    const audioBuffer = Buffer.from(await audioResp.arrayBuffer())

    // Step 3: Transcribe with Whisper
    // Create a File object from the buffer
    const audioFile = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' })

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      // Language hint for Hindi/Hinglish (auto-detect is also fine)
    })

    logger.info({ mediaId, chars: transcription.text.length }, '[transcription] Whisper success')
    return transcription.text
  } catch (err) {
    logger.error({ err, mediaId }, '[transcription] Whisper failed')
    return null
  }
}
