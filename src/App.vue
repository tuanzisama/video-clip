<template>
  <div class="container">
    <div class="video-container">
      <div class="video-box">
        <div class="video-header">
          <span>预览区</span>
        </div>
        <t-loading class="video-wrapper" :loading="isVideoLoading">
          <video class="video-inner" ref="videoRef" :src="rawFileBlobUrl" controls
            @loadeddata="onVideoLoadedDataHandler"></video>
        </t-loading>
      </div>
      <div class="video-box output" :style="{ '--output-percent': `${generatePercent}%` }">
        <div class="video-header">
          <span>生成区</span>
        </div>
        <t-loading class="video-wrapper" :loading="isFFmpegProcessing">
          <video class="video-inner" ref="videoOutoutRef" :src="outputVideoBlobUrl" controls></video>
        </t-loading>
      </div>
    </div>
    <div class="control-container">
      <div class="operation-box">
        <t-button @click="onSelectMediaFileClickHandler">选择文件</t-button>

        <t-descriptions v-if="rawFile" :column="1" size="small">
          <t-descriptions-item label="名称">{{ rawFile!.name }}</t-descriptions-item>
          <t-descriptions-item label="大小">{{ prettyBytes(rawFile!.size) }}</t-descriptions-item>
          <t-descriptions-item label="MIME">{{ rawFile!.type }}</t-descriptions-item>
        </t-descriptions>

        <t-divider>生成</t-divider>
        <div class="slide-box" v-if="isVideoLoaded">
          <t-slider v-model="slideRange" :max="videoDuration" range @change="onSliderChangeHandler" />
          <span class="clip-duration-text">{{ clipDurationSeconds }}s</span>
        </div>
        <t-button @click="onStartTransCodeClickHandler" :disabled="!isVideoLoaded">开始</t-button>

        <t-divider>结果</t-divider>
        <t-button @click="onDownloadOutputClickHandler" :disabled="!isOutputed">下载</t-button>

        <t-descriptions v-if="isOutputed" :column="1" size="small">
          <t-descriptions-item label="导出用时">
            <t-tooltip :content="`精确处理时间: ${outputUsageDuration}ms`" placement="top-left" show-arrow theme="light">
              <span class="usage-time">{{ (outputUsageDuration / 1000).toFixed(2) }}s</span>
            </t-tooltip>
          </t-descriptions-item>
          <t-descriptions-item label="大小">
            {{ prettyBytes(rawFile!.size) }}➡{{ prettyBytes(outputVideoBlob!.size) }}
          </t-descriptions-item>
          <t-descriptions-item label="MIME">{{ outputVideoBlob!.type }}</t-descriptions-item>
        </t-descriptions>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onBeforeMount, onMounted, ref, shallowRef } from 'vue';
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import NotificationPlugin from 'tdesign-vue-next/es/notification/plugin';
import { saveAs } from 'file-saver';

import dayjs from 'dayjs';
import objectSupport from 'dayjs/plugin/objectSupport'

import prettyBytes from 'pretty-bytes';

const videoRef = ref<HTMLVideoElement>()
const videoOutoutRef = ref<HTMLVideoElement>()
const rawFileBlobUrl = ref<string>();
const rawFile = ref<File>()
const slideRange = ref<number[]>([0, 100])
const videoDuration = ref<number>(0)
const isVideoLoading = ref<boolean>(false)
const isVideoLoaded = ref<boolean>(false)
const ffmpegRef = shallowRef<FFmpeg>();

const isFFmpegProcessing = ref<boolean>(false)
const outputVideoBlob = ref<Blob | null>(null)
const outputVideoBlobUrl = ref<string>()
const outputUsageDuration = ref<number>(0)
const generatePercent = ref<string>('0%')
const isOutputed = ref<boolean>(false)

const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'

const clipDurationSeconds = computed(() => {
  if (slideRange.value.length === 2) {
    return slideRange.value[1] - slideRange.value[0]
  }
})

onMounted(() => {
  dayjs.extend(objectSupport);

  if (!window.WebAssembly) {
    alert("你的浏览器不支持 WebAssembly")
  }
})

onBeforeMount(() => {
  if (rawFileBlobUrl.value) {
    window.URL.revokeObjectURL(rawFileBlobUrl.value)
  }
})

const onSelectMediaFileClickHandler = () => {
  const fileEl = document.createElement('input')
  fileEl.setAttribute('type', 'file')
  fileEl.setAttribute('accept', 'video/*')
  fileEl.addEventListener('change', () => {
    const file = fileEl.files?.[0]
    if (!file) {
      MessagePlugin.error("请选择一个文件")
    }
    isVideoLoading.value = true
    rawFile.value = file;
    rawFileBlobUrl.value = window.URL.createObjectURL(file as File);

    resetOutputStatus()
  })
  fileEl.click()
}

const onVideoLoadedDataHandler = () => {
  videoDuration.value = videoRef.value?.duration ?? -1
  isVideoLoading.value = false
  isVideoLoaded.value = true
  const gap = Math.round(videoDuration.value / 4)
  slideRange.value = [gap, gap * 3]
}

const resetOutputStatus = () => {
  isFFmpegProcessing.value = false
  isOutputed.value = false
  outputVideoBlob.value = null
  if (outputVideoBlobUrl.value) {
    URL.revokeObjectURL(outputVideoBlobUrl.value)
    outputVideoBlobUrl.value = ''
    videoOutoutRef.value?.setAttribute('src', '')
  }
  outputUsageDuration.value = 0
  generatePercent.value = '0%'
}

const onStartTransCodeClickHandler = async () => {
  resetOutputStatus()
  try {
    isFFmpegProcessing.value = true;

    const startTime = performance.now();

    await setupFFmpeg()

    const endTime = performance.now()
    outputUsageDuration.value = (endTime - startTime)

    isOutputed.value = true

    NotificationPlugin.success({ title: "生成完毕" })
    setTimeout(() => {
      generatePercent.value = '0%'
    }, 1000);
  } catch (error) {
    console.error(error);
  } finally {
    isFFmpegProcessing.value = false;
  }
}

const setupFFmpeg = async () => {
  console.info('start load');
  if (!ffmpegRef.value) {
    const ffmpeg = new FFmpeg()
    ffmpegRef.value = ffmpeg

    ffmpeg.on("progress", ({ progress, time }) => {
      console.info(progress, time);
      generatePercent.value = (progress * 100).toFixed(2)
    })

    ffmpeg.on('log', ({ message }) => {
      console.log(message);
    });
    // toBlobURL is used to bypass CORS issue, urls with the same
    // domain can be used directly.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${ffmpegBaseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${ffmpegBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${ffmpegBaseURL}/ffmpeg-core.worker.js`, 'text/javascript')
    });
  }
  console.info('ffmpeg Loaded!');
  await ffmpegTransCode()
}

const ffmpegTransCode = (): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    try {
      const ffmpeg = ffmpegRef.value

      const inputFileName = rawFile.value?.name ?? 'input.mp4';
      await ffmpeg!.writeFile(inputFileName, await fetchFile(rawFile.value));

      const startTime = dayjs({ second: slideRange.value[0] }).format('HH:mm:ss')
      const endTime = dayjs({ second: slideRange.value[1] }).format('HH:mm:ss')

      console.info('[startTime]', startTime);
      console.info('[endTime]', endTime);

      await ffmpeg!.exec([
        '-ss',
        startTime,
        '-to',
        endTime,
        '-i',
        inputFileName,
        '-c',
        'copy',
        'output.mp4'
      ]);
      const data = await ffmpegRef.value!.readFile('output.mp4') as TypedArray;

      outputVideoBlob.value = new Blob([data.buffer], { type: 'video/mp4' });
      outputVideoBlobUrl.value = window.URL.createObjectURL(outputVideoBlob.value)

      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

const onDownloadOutputClickHandler = () => {
  if (outputVideoBlobUrl.value) {
    NotificationPlugin.success({ title: "正在下载", content: "请留意浏览器下载列表" })
    saveAs(outputVideoBlobUrl.value, `[output]${rawFile.value?.name}`)
  } else {
    NotificationPlugin.error({ title: "流不存在" })
  }
}

const tempSlideValue = ref<number[]>([])
const onSliderChangeHandler = (value: number[]) => {
  if (tempSlideValue.value[0] !== value[0]) {
    moveVideoTime(value[0])
  } else if (tempSlideValue.value[1] !== value[1]) {
    moveVideoTime(value[1])
  }

  function moveVideoTime(time: number) {
    if (videoRef.value) {
      videoRef.value.pause()
      videoRef.value.currentTime = time
    }
  }
  tempSlideValue.value = value
}
</script>

<style lang="scss" scoped>
.container {
  width: 1200px;
  max-width: 96%;
  margin: 0 auto;
  display: flex;
  gap: 15px;
}

.video-container {
  display: flex;
  flex-direction: column;
  width: 0;
  flex: 1;
  gap: 15px;
  margin: 20px 0;

  .video-box {
    width: 100%;
    height: 500px;
    padding: 20px;
    border: 3px dashed #757575;
    border-radius: 10px;
    display: flex;
    flex-direction: column;

    &.output {
      border-color: #2196F3;
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: var(--output-percent);
        height: 10px;
        background-color: #00E676;
        transition: width .2s;
      }
    }

    .video-header {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 20px;
    }

    .video-wrapper {
      width: 100%;
      flex: 1;
      height: 0;

      .video-inner {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
    }
  }
}

.control-container {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 15px;


  .operation-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
    padding-top: 20px;

    position: sticky;
    top: 0;
    right: 0;
  }

  .t-divider {
    margin: 5px 0;
  }

  .slide-box {
    width: 100%;
    display: flex;
    align-items: center;

    .clip-duration-text {
      font-size: 14px;
      margin-left: 10px;
    }
  }
}
</style>