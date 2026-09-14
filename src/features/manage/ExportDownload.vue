<script setup lang="ts">
/**
 * The emailed export link, /manage/export/:id (spec §11.3): opened in any browser that is not a display. The owner
 * signs in again with an emailed code (the same AdultSignIn and 5-minute idle sign-out as Manage household), then the
 * page reads the export with that sign-in. Only an owner of the export's household sees it; everyone else, and a link
 * to an export that no longer exists, gets "This export isn't available to you". A ready export downloads through a
 * 10-minute signed URL opened in this page; pending, failed and expired exports say so. Nothing here reads the
 * display's session.
 */
import { nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { ExportStatus } from '@/data/exportApi'
import type { AdultClient } from '@/data/settingsApi'
import AdultSignIn from '@/features/settings/AdultSignIn.vue'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import RButton from '@/ui/RButton.vue'
import RLogo from '@/ui/RLogo.vue'
import { IDLE_SIGNED_OUT, SESSION_ENDED, SIGNED_OUT } from './useManageHousehold'

export interface ExportDownloadApi {
  exportStatus(client: AdultClient, exportId: string): Promise<ExportStatus>
  exportDownloadUrl(client: AdultClient, exportId: string): Promise<string>
}

type Phase = 'signIn' | 'loading' | 'loadFailed' | 'unavailable' | 'pending' | 'failed' | 'expired' | 'ready'

const props = defineProps<{
  id: string
  /** The export API (tests); otherwise loaded when first needed. */
  api?: ExportDownloadApi
  /** Starts the download (tests); otherwise `window.location.assign`. */
  assign?: (url: string) => void
  idleMs?: number
}>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const phase = ref<Phase>('signIn')
const adult = shallowRef<AdultSession | null>(null)
const row = shallowRef<ExportStatus | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const signInKey = ref(0)
const root = useTemplateRef<HTMLElement>('root')

let apiLoading: Promise<ExportDownloadApi> | null = props.api ? Promise.resolve(props.api) : null
function loadApi(): Promise<ExportDownloadApi> {
  apiLoading ??= import('@/data/exportApi').catch((e: unknown) => {
    apiLoading = null
    throw e
  })
  return apiLoading
}

function resetToSignIn(message: string | null): void {
  adult.value = null
  row.value = null
  busy.value = false
  error.value = null
  notice.value = message
  signInKey.value += 1
  phase.value = 'signIn'
}

function signOut(message: string | null = SIGNED_OUT): void {
  const current = adult.value
  resetToSignIn(message)
  if (current) void current.end().catch(() => {})
}

useAdultSessionIdle({
  session: () => adult.value,
  busy: () => busy.value,
  onExpired: () => resetToSignIn(IDLE_SIGNED_OUT),
  idleMs: props.idleMs,
})

/** An ExportError's reason (see exportApi), or null for any other error. */
function reasonOf(e: unknown): string | null {
  const reason = (e as { reason?: unknown } | null)?.reason
  return typeof reason === 'string' ? reason : null
}

function messageOf(e: unknown): string {
  return e instanceof Error && reasonOf(e) ? e.message : 'Something went wrong. Try again.'
}

function show(status: ExportStatus): void {
  row.value = status
  if (status.status === 'pending') phase.value = 'pending'
  else if (status.status === 'failed') phase.value = 'failed'
  else phase.value = status.expired ? 'expired' : 'ready'
}

/** Applies a failed load or download. Returns true when it moved the page to another state. */
function followError(session: AdultSession, e: unknown): boolean {
  if (adult.value !== session) return true
  switch (reasonOf(e)) {
    case 'session':
      signOut(SESSION_ENDED)
      return true
    case 'not_found':
    case 'forbidden':
      phase.value = 'unavailable'
      return true
    case 'expired':
      phase.value = 'expired'
      return true
    case 'failed':
      phase.value = 'failed'
      return true
    case 'not_ready':
      phase.value = 'pending'
      return true
    default:
      return false
  }
}

async function load(): Promise<void> {
  const session = adult.value
  if (!session) return
  error.value = null
  if (!UUID_RE.test(props.id)) {
    phase.value = 'unavailable'
    return
  }
  phase.value = 'loading'
  busy.value = true
  try {
    const status = await (await loadApi()).exportStatus(session.client, props.id)
    if (adult.value === session) show(status)
  } catch (e) {
    if (!followError(session, e)) {
      error.value = messageOf(e)
      phase.value = 'loadFailed'
    }
  } finally {
    if (adult.value === session) busy.value = false
  }
}

async function onSignedIn(session: AdultSession): Promise<void> {
  adult.value = session
  notice.value = null
  await load()
}

async function download(): Promise<void> {
  const session = adult.value
  if (!session || busy.value) return
  error.value = null
  busy.value = true
  try {
    const url = await (await loadApi()).exportDownloadUrl(session.client, props.id)
    if (adult.value !== session) return
    // A normal navigation in this page: the signed URL answers with Content-Disposition: attachment, so the page stays.
    const start = props.assign ?? ((u: string) => window.location.assign(u))
    start(url)
  } catch (e) {
    if (!followError(session, e)) error.value = messageOf(e)
  } finally {
    if (adult.value === session) busy.value = false
  }
}

const expiresLabel = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

// Each state's heading takes focus, so a screen reader announces where the owner is.
watch(phase, async () => {
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-export-heading], [data-step-heading]')?.focus()
})
</script>

<template>
  <main
    ref="root"
    class="min-h-dvh bg-app px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),32px)] text-ink sm:px-8"
  >
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div class="flex items-center gap-2 py-2">
        <RLogo :size="26" />
        <span class="text-[20px] font-medium">roost family</span>
      </div>

      <template v-if="phase === 'signIn'">
        <p v-if="notice" role="status" class="text-[18px] font-medium text-ink-2">{{ notice }}</p>
        <AdultSignIn
          :key="signInKey"
          heading="h1"
          title="Download your export"
          hint="Sign in as an owner of the household to download its export. You’re signed out after 5 minutes without a touch."
          :hold-night="false"
          :cancellable="false"
          @signed-in="onSignedIn"
        />
      </template>

      <p v-else-if="phase === 'loading'" role="status" tabindex="-1" data-export-heading class="text-[20px] text-ink-2 outline-none">
        Loading your export…
      </p>

      <section v-else class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5" aria-labelledby="export-title">
        <template v-if="phase === 'ready' && row">
          <h1 id="export-title" tabindex="-1" data-export-heading class="text-[32px] font-semibold text-ink outline-none">Your export is ready</h1>
          <p class="text-[18px] text-ink-2">
            A ZIP file with a spreadsheet for each log, plus all of your household’s data and photos.
          </p>
          <p class="text-[18px] text-ink-3">Available until {{ expiresLabel(row.expiresAt) }}.</p>
          <div class="flex flex-wrap gap-3">
            <RButton :disabled="busy" @click="download">Download export</RButton>
          </div>
        </template>

        <template v-else-if="phase === 'pending'">
          <h1 id="export-title" tabindex="-1" data-export-heading class="text-[32px] font-semibold text-ink outline-none">Still preparing…</h1>
          <p class="text-[18px] text-ink-2">Your export is still being put together. This usually takes a minute or two.</p>
          <div class="flex flex-wrap gap-3">
            <RButton :disabled="busy" @click="load">Refresh</RButton>
          </div>
        </template>

        <template v-else-if="phase === 'failed' || phase === 'expired'">
          <h1 id="export-title" tabindex="-1" data-export-heading class="text-[32px] font-semibold text-ink outline-none">
            {{ phase === 'failed' ? 'This export didn’t finish' : 'This export has expired' }}
          </h1>
          <p class="text-[18px] text-ink-2">
            {{
              phase === 'failed'
                ? 'Something went wrong while preparing it. You can ask for a new one from Manage household.'
                : 'Export links work for 24 hours. You can ask for a new one from Manage household.'
            }}
          </p>
          <div>
            <RouterLink
              to="/manage"
              class="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] bg-orange-deep px-6 text-[18px] font-semibold text-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
            >
              Request a new export
            </RouterLink>
          </div>
        </template>

        <template v-else-if="phase === 'unavailable'">
          <h1 id="export-title" tabindex="-1" data-export-heading class="text-[32px] font-semibold text-ink outline-none">
            This export isn’t available to you
          </h1>
          <p class="text-[18px] text-ink-2">
            Only an owner of the household can download it. If you signed in with another email, sign out and try again.
          </p>
        </template>

        <template v-else>
          <h1 id="export-title" tabindex="-1" data-export-heading class="text-[32px] font-semibold text-ink outline-none">Download your export</h1>
          <div>
            <RButton :disabled="busy" @click="load">Try again</RButton>
          </div>
        </template>

        <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

        <div class="border-t border-surface-2 pt-4">
          <RButton variant="secondary" @click="signOut()">Sign out</RButton>
        </div>
      </section>
    </div>
  </main>
</template>
