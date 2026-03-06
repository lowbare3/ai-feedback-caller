/**
 * Simple in-memory call queue with concurrency control.
 * Processes Bolna API calls one at a time (or N at a time) with a delay between each,
 * so 200 simultaneous webhook events don't fire 200 API calls at once.
 */

class CallQueue {
    /**
     * @param {number} concurrency - Max parallel calls (default 1 = sequential)
     * @param {number} delayBetweenMs - Delay between processing each job (default 2000ms)
     */
    constructor(concurrency = 2, delayBetweenMs = 2000) {
        this.concurrency = concurrency;
        this.delayBetweenMs = delayBetweenMs;
        this.queue = [];
        this.running = 0;
        this.processed = 0;
        this.failed = 0;
    }

    /**
     * Add a job to the queue. Returns immediately — the job runs later.
     * @param {object} job - { sellerId, phone, liveId, delayMinutes, execute }
     *   execute is an async function that performs the actual work
     */
    enqueue(job) {
        this.queue.push(job);
        console.log(`[Queue] Job added — seller: ${job.sellerId}, live: ${job.liveId} | Queue size: ${this.queue.length}, Running: ${this.running}`);
        this._processNext();
    }

    async _processNext() {
        // Respect concurrency limit
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift();
        this.running++;

        try {
            console.log(`[Queue] Processing — seller: ${job.sellerId} | Remaining: ${this.queue.length}, Running: ${this.running}`);
            await job.execute();
            this.processed++;
        } catch (error) {
            this.failed++;
            console.error(`[Queue] Job failed — seller: ${job.sellerId}:`, error.message);
        } finally {
            this.running--;

            // Wait between jobs to avoid hammering the API
            if (this.queue.length > 0) {
                setTimeout(() => this._processNext(), this.delayBetweenMs);
            }
        }
    }

    /**
     * Get current queue stats.
     */
    getStats() {
        return {
            queued: this.queue.length,
            running: this.running,
            processed: this.processed,
            failed: this.failed,
        };
    }
}

module.exports = CallQueue;
