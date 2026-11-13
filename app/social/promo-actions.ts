'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { getRole } from '@/lib/security/roles';
import { AI_OFF_MESSAGE } from '@/lib/ai/consent';
import { aiBlocked } from '@/lib/ai/gate';
import { routeJson } from '@/lib/ai/router';
import { getPersonSettings } from '@/lib/locale/repository';
import { claimSocialAiCredit } from '@/lib/social/ai-credit';
import { todayIn } from '@/lib/social/month';
import { draftMaxTokens } from '@/lib/social/ai-draft';
import { buildPromoPrompt, parsePromoReply, promoFirstDay, promoImagePrompt, readPromoRequest } from '@/lib/social/promo';
import { generatePromoImage } from '@/lib/social/promo-image';
import { SocialError, getPost, insertPost, removeMediaFiles, updatePost, uploadMediaBytes } from '@/lib/social/repository';
import type { SocialPost } from '@/lib/social/types';

type Result = { success: boolean; message: string; post?: SocialPost; posts?: SocialPost[] };

const SIGN_IN = { success: false, message: 'Sign in again to do this.' } as const;
const NOT_YOURS = { success: false, message: 'That account isn’t available.' } as const;
const NO_MODEL_MESSAGE = 'No AI model is available right now. Try again later or write the post yourself.';

/** The signed-in owner's id, or the refusal for anyone else. Checked before any AI credit is spent. */
async function ownerOnly(): Promise<{ userId: string } | Result> {
  const userId = (await requireUser())?.userId;
  if (!userId) return SIGN_IN;
  return (await getRole(userId)) === 'owner' ? { userId } : NOT_YOURS;
}

/**
 * Makes a picture for a post and attaches it. False when anything fails; a
 * file that was stored but could not be attached is removed again, so the
 * post never points at a missing picture.
 */
async function addImage(userId: string, post: SocialPost, imageIdea: string): Promise<SocialPost | null> {
  const image = await generatePromoImage(promoImagePrompt(post.headline || post.title, imageIdea), {
    geminiKey: process.env.GEMINI_API_KEY?.trim(),
    geminiModel: process.env.GEMINI_IMAGE_MODEL?.trim(),
    openRouterKey: process.env.OPENROUTER_API_KEY?.trim(),
    openRouterModel: process.env.OPENROUTER_IMAGE_MODEL?.trim(),
  });
  if (!image) return null;
  const path = `${userId}/${post.id}/${randomUUID()}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  if (!(await uploadMediaBytes(path, image.bytes, image.mimeType))) return null;
  try {
    return await updatePost(userId, post.id, { mediaPath: path, mediaType: 'image' });
  } catch {
    await removeMediaFiles([path]);
    return null;
  }
}

/**
 * Suggests 1-3 posts for Orbis's own promotion page, each with a picture.
 * Owner only. Text comes only from the fixed Orbis facts (lib/social/orbis-facts.ts).
 * One press spends one of the day's AI requests. Posts are saved as AI drafts
 * on the Orbis account; nothing is posted.
 */
export async function suggestPromoPostsAction(input: { period: string; count: number; brief: string }): Promise<Result> {
  const gate = await ownerOnly();
  if (!('userId' in gate)) return gate;
  const { userId } = gate;
  const request = readPromoRequest(input);
  if (typeof request === 'string') return { success: false, message: request };

  const today = todayIn((await getPersonSettings(userId)).timeZone);
  const firstDay = promoFirstDay(request.period, today);
  if (firstDay === null) return { success: false, message: 'Pick this month or a later one.' };

  const blocked = await aiBlocked(userId);
  if (blocked) return { success: false, message: blocked === 'off' ? AI_OFF_MESSAGE : NO_MODEL_MESSAGE };
  const refused = await claimSocialAiCredit(userId);
  if (refused) return { success: false, message: refused };

  const prompt = buildPromoPrompt({ ...request, firstDay });
  const result = await routeJson({
    userId,
    feature: 'social_promo',
    sensitivity: 'general',
    system: prompt.system,
    user: prompt.user,
    maxTokens: draftMaxTokens(request.count),
    temperature: 0.7,
    timeoutMs: 30_000,
    accept: (text) => parsePromoReply(text, request).length > 0,
  });
  if (!result) return { success: false, message: NO_MODEL_MESSAGE };
  const drafts = parsePromoReply(result.text, request);
  if (!drafts.length) return { success: false, message: 'The AI reply could not be used. Try again.' };

  // One after another, not in parallel: the image model has tight rate limits.
  const posts: SocialPost[] = [];
  let missingImages = 0;
  for (const { imageIdea, ...draft } of drafts) {
    let post: SocialPost;
    try {
      post = await insertPost(userId, { ...draft, account: 'orbis', platforms: ['instagram'], status: 'draft', source: 'ai' }, 'ai_draft');
    } catch (error) {
      if (error instanceof SocialError && !posts.length) return { success: false, message: error.message };
      continue;
    }
    const withImage = await addImage(userId, post, imageIdea);
    if (!withImage) missingImages += 1;
    posts.push(withImage ?? post);
  }
  if (!posts.length) return { success: false, message: 'The posts could not be saved. Try again.' };
  revalidatePath('/active');
  const added = `${posts.length} Orbis ${posts.length === 1 ? 'post' : 'posts'} added. Check each before you keep it.`;
  return { success: true, message: missingImages ? `${added} Some images couldn’t be made.` : added, posts };
}

/** A new picture for one Orbis post (owner only, one AI request); the old file is removed once the new one is attached. */
export async function retryPromoImageAction(postId: string): Promise<Result> {
  const gate = await ownerOnly();
  if (!('userId' in gate)) return gate;
  const { userId } = gate;
  if (!isUuid(postId)) return { success: false, message: 'That post is invalid.' };
  try {
    const before = await getPost(userId, postId);
    if (!before || before.account !== 'orbis') return { success: false, message: 'That post no longer exists.' };
    if (before.status === 'published') return { success: false, message: 'This post is published. Mark it as not published to change it.' };
    const blocked = await aiBlocked(userId);
    if (blocked) return { success: false, message: blocked === 'off' ? AI_OFF_MESSAGE : NO_MODEL_MESSAGE };
    const refused = await claimSocialAiCredit(userId);
    if (refused) return { success: false, message: refused };
    const post = await addImage(userId, before, before.headline || before.title);
    if (!post) return { success: false, message: 'Image couldn’t be made. Try again later.' };
    if (before.mediaPath && before.mediaPath !== post.mediaPath) await removeMediaFiles([before.mediaPath]);
    revalidatePath('/active');
    return { success: true, message: 'New image added.', post };
  } catch (error) {
    return { success: false, message: error instanceof SocialError ? error.message : 'Image couldn’t be made. Try again later.' };
  }
}
