import 'server-only';

import { deleteSavedAiResultAction } from '@/app/ai/result-actions';
import { askOrbisAction } from '@/app/ask/actions';
import * as career from '@/app/career/actions';
import * as finance from '@/app/finance/actions';
import * as headsups from '@/app/headsups/actions';
import * as health from '@/app/health/actions';
import * as healthLibrary from '@/app/health/library-actions';
import * as steps from '@/app/health/steps-actions';
import * as brief from '@/app/home/brief-actions';
import { acknowledgeMailAction } from '@/app/home/mail-actions';
import { loadInvestLiveAction } from '@/app/invest/actions';
import { generatePortfolioAdviceAction } from '@/app/invest/ai-actions';
import * as personal from '@/app/personal/actions';
import * as journal from '@/app/personal/journal-actions';
import { saveNotificationPreferencesAction, sendTestNotificationAction } from '@/app/personal/notification-actions';
import { deleteVoiceNoteAction, voiceNoteUrlAction } from '@/app/personal/voice-actions';
import * as research from '@/app/research/actions';
import * as routines from '@/app/routines/actions';
import * as social from '@/app/social/actions';
import { loadSocialInsightsAction } from '@/app/social/insights-actions';

type AnyAction = (...args: never[]) => Promise<unknown>;

/**
 * What POST /api/v1/actions/<name> may call: the app's own server actions, by
 * name, with the same checks they run for the app.
 *
 * An allowlist, so a new action is never exposed by accident. Left out on
 * purpose, and kept to the app:
 * - signing in and out, passwords, the PIN and app lock, deleting the account,
 *   and the waitlist;
 * - anything that sends a message as the user (career applications, follow-ups
 *   and offer replies go out from the app only, on a press);
 * - connecting or disconnecting accounts (Gmail, brokers, Instagram, Threads)
 *   and push subscriptions, which belong to a browser;
 * - voice uploads and Talk to Orbis, which take form data, not JSON.
 */
export const API_ACTIONS: Record<string, AnyAction> = {
  'ai.deleteSavedResult': deleteSavedAiResultAction,
  'ask.ask': askOrbisAction,

  'career.load': career.loadCareerAction,
  'career.loadSetup': career.loadSetupAction,
  'career.listJobs': career.listJobsAction,
  'career.jobDetail': career.jobDetailAction,
  'career.createResumeUpload': career.createResumeUploadAction,
  'career.processResume': career.processResumeAction,
  'career.saveProfile': career.saveProfileAction,
  'career.saveSpec': career.saveSpecAction,
  'career.specFromSentence': career.specFromSentenceAction,
  'career.saveSettings': career.saveSettingsAction,
  'career.pasteJob': career.pasteJobAction,
  'career.setJobState': career.setJobStateAction,
  'career.rescoreJob': career.rescoreJobAction,
  'career.draftApplication': career.draftApplicationAction,
  'career.updateDraft': career.updateDraftAction,
  'career.markApplied': career.markAppliedAction,
  'career.ownerMoves': career.ownerMovesAction,
  'career.moveApplication': career.moveApplicationAction,
  'career.attachReply': career.attachReplyAction,
  'career.saveOfferTerms': career.saveOfferTermsAction,
  'career.adviseOffer': career.adviseOfferAction,
  'career.runSearchNow': career.runSearchNowAction,
  'career.insights': career.insightsAction,
  'career.exportTracker': career.exportTrackerAction,

  'finance.addManualTransaction': finance.addManualTransactionAction,
  'finance.deleteManualTransaction': finance.deleteManualTransactionAction,
  'finance.saveIncomePlan': finance.saveIncomePlanAction,
  'finance.deleteIncomePlan': finance.deleteIncomePlanAction,

  'headsups.snooze': headsups.snoozeHeadsupAction,
  'headsups.dismiss': headsups.dismissHeadsupAction,
  'headsups.complete': headsups.completeHeadsupAction,
  'headsups.setKind': headsups.setHeadsupKindAction,
  'headsups.clear': headsups.clearHeadsupsAction,

  'health.signWorkbookUpload': health.signWorkbookUploadAction,
  'health.parseWorkbook': health.parseWorkbookAction,
  'health.generateWorkbookAdvice': health.generateWorkbookAdviceAction,
  'health.setDocumentAlways': healthLibrary.setHealthDocumentAlwaysAction,
  'health.signDocumentUpload': healthLibrary.signHealthDocumentUploadAction,
  'health.uploadDocument': healthLibrary.uploadHealthDocumentAction,
  'health.deleteDocument': healthLibrary.deleteHealthDocumentAction,
  'health.downloadDocument': healthLibrary.downloadHealthDocumentAction,
  'health.startPlan': healthLibrary.startHealthPlanAction,
  'health.generatePlan': healthLibrary.generateHealthPlanAction,
  'health.deletePlan': healthLibrary.deleteHealthPlanAction,
  'health.importAppleHealthSteps': steps.importAppleHealthStepsAction,
  'health.deleteSteps': steps.deleteHealthStepsAction,

  'home.setBriefEnabled': brief.setHomeBriefEnabledAction,
  'home.setAiEnabled': brief.setAiEnabledAction,
  'home.aiUsage': brief.aiUsageAction,
  'home.acknowledgeMail': acknowledgeMailAction,

  'invest.loadLive': loadInvestLiveAction,
  'invest.generatePortfolioAdvice': generatePortfolioAdviceAction,

  'personal.addNote': personal.addContextNoteAction,
  'personal.updateNote': personal.updateContextNoteAction,
  'personal.deleteNote': personal.deleteContextNoteAction,
  'personal.noteHistory': personal.loadNoteHistoryAction,
  'personal.deletedNotes': personal.loadDeletedNotesAction,
  'personal.saveFitnessPersona': personal.saveFitnessPersonaAction,
  'personal.deleteFitnessPersona': personal.deleteFitnessPersonaAction,
  'personal.saveProfile': personal.savePersonalProfileAction,
  'personal.deleteProfile': personal.deletePersonalProfileAction,
  'personal.saveHomeCity': personal.saveHomeCityAction,
  'personal.clearHomeCity': personal.clearHomeCityAction,

  'journal.saveEntry': journal.saveJournalEntryAction,
  'journal.deleteEntry': journal.deleteJournalEntryAction,
  'journal.history': journal.loadJournalHistoryAction,
  'journal.deleted': journal.loadDeletedJournalAction,
  'journal.voiceNoteUrl': voiceNoteUrlAction,
  'journal.deleteVoiceNote': deleteVoiceNoteAction,

  'notifications.savePreferences': saveNotificationPreferencesAction,
  'notifications.sendTest': sendTestNotificationAction,

  'research.load': research.loadResearchDeskAction,
  'research.start': research.startResearchAction,
  'research.loadRun': research.loadResearchRunAction,
  'research.cancelRun': research.cancelResearchRunAction,
  'research.saveSettings': research.saveResearchSettingsAction,

  'routines.save': routines.saveRoutineAction,
  'routines.archive': routines.archiveRoutineAction,
  'routines.delete': routines.deleteRoutineAction,
  'routines.answer': routines.answerRoutineAction,

  'social.loadMonth': social.loadSocialMonthAction,
  'social.savePost': social.savePostAction,
  'social.setPostStatus': social.setPostStatusAction,
  'social.markPublished': social.markPublishedAction,
  'social.duplicatePost': social.duplicatePostAction,
  'social.movePost': social.movePostAction,
  'social.deletePost': social.deletePostAction,
  'social.signMediaUpload': social.signMediaUploadAction,
  'social.attachMedia': social.attachMediaAction,
  'social.removeMedia': social.removeMediaAction,
  'social.draftWithAi': social.draftMonthWithAiAction,
  'social.postHistory': social.loadPostHistoryAction,
  'social.insights': loadSocialInsightsAction,
};

export function apiAction(name: string): AnyAction | null {
  return Object.hasOwn(API_ACTIONS, name) ? API_ACTIONS[name] : null;
}
