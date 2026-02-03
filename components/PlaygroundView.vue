<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import JSZip from 'jszip'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { parseTer } from '../services/ter-new'
import { Upload, Download, Loader2, AlertCircle, Code, FolderOpen } from 'lucide-vue-next'
import FileTreeNode from './FileTreeNode.vue'
import SceneSettingsPanel from './SceneSettingsPanel.vue'

const props = defineProps({
  initialZip: {
    type: Object,
    default: null
  }
})

const fileInput = ref(null)
const canvasContainer = ref(null)
const isLoading = ref(false)
const error = ref('')
const loadedLevelName = ref('')
const loadedLevelData = ref(null)
const fileTree = ref([])

// Scene Settings State
const quality = ref('high')
const preset = ref('dawn')
const textureType = ref('satellite')
const showWireframe = ref(false)
const osmAvailable = ref(false)
const hybridAvailable = ref(false)

const presets = ['city', 'dawn', 'sunset', 'night', 'forest', 'studio', 'umbrellas', 'snow', 'hangar', 'urban', 'modern', 'shangai']

// Texture Refs for quick swapping
const textures = {
    satellite: null,
    osm: null,
    hybrid: null,
    layer: null
}

let scene, camera, renderer, controls, terrainMesh, resizeObserver, currentZip

// Watchers
watch(quality, () => {
    if (loadedLevelData.value && currentZip) {
        createTerrainMesh(loadedLevelData.value, currentZip)
    }
})

watch(showWireframe, (val) => {
    if (terrainMesh) {
        terrainMesh.material.wireframe = val
    }
})

watch(textureType, (val) => {
    if (!terrainMesh) return
    
    // Ensure material is standard material
    if (val === 'none') {
        terrainMesh.material.map = null
        terrainMesh.material.color.setHex(0xffffff)
    } else {
        terrainMesh.material.color.setHex(0xffffff)
        const tex = textures[val]
        if (tex) {
            terrainMesh.material.map = tex
        } else if (val === 'satellite' && textures.layer) {
            // Fallback to generated layer map if satellite missing
            terrainMesh.material.map = textures.layer
        }
        
    }
    terrainMesh.material.needsUpdate = true
})

watch(preset, (val) => {
    updateEnvironment(val)
})

function updateEnvironment(p) {
    if (!scene) return
    
    // Simple environment simulation
    const colors = {
        city: 0x88CCFF,
        dawn: 0xffcc99,
        sunset: 0xff9966,
        night: 0x050510,
        forest: 0x88aa88,
        snow: 0xddeeff,
        studio: 0x444444,
        shangai: 0x553322
    }
    
    const col = colors[p] || 0x111111
    scene.background = new THREE.Color(col)
    
    // Disable fog to match MapNG preview crispness
    scene.fog = null 
    // scene.fog = new THREE.FogExp2(col, 0.00025)
}

onMounted(() => {
  initThree()
  // Monitor container size changes (e.g. sidebar collapse)
  resizeObserver = new ResizeObserver(() => onResize())
  if (canvasContainer.value) {
    resizeObserver.observe(canvasContainer.value)
  }

  // Load initial zip if provided
  if (props.initialZip) {
    loadZip(props.initialZip, 'Generated Level')
  }
})

// Update watcher to handle if initialZip changes while component is alive
watch(() => props.initialZip, (newVal) => {
    if (newVal) {
        loadZip(newVal, 'Generated Level')
    }
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (renderer) renderer.dispose()
})

function initThree() {
  if (!canvasContainer.value) return

  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111111)

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000)
  camera.position.set(1000, 1000, 1000)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  // Use ACESFilmic for better dynamic range (matches TresJS default)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  canvasContainer.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  // Match brightness of Preview3D
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0)
  dirLight.position.set(500, 1000, 750)
  dirLight.castShadow = true
  scene.add(dirLight)

  animate()
}

function onResize() {
  if (!camera || !renderer || !canvasContainer.value) return
  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

function animate() {
  requestAnimationFrame(animate)
  if (controls) controls.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function triggerFileUpload() {
  fileInput.value.click()
}

async function handleFileChange(event) {
  const file = event.target.files[0]
  if (!file) return

  isLoading.value = true
  error.value = ''
  
  try {
    const zip = new JSZip()
    await zip.loadAsync(file)
    await loadZip(zip, file.name)
  } catch (err) {
      console.error(err)
      error.value = err.message || 'Failed to load level data'
      isLoading.value = false
  } finally {
      if (fileInput.value) fileInput.value.value = ''
  }
}

async function loadZip(zip, name) {
    currentZip = zip
    loadedLevelName.value = name
    isLoading.value = true
    error.value = ''
    
    // Reset state stuff
    textures.satellite = null
    textures.osm = null
    textures.hybrid = null
    textures.layer = null
    osmAvailable.value = false
    hybridAvailable.value = false
    
    try {
        // Build File Tree
        const paths = []
        zip.forEach((relativePath) => paths.push(relativePath))
        paths.sort()
        
        // Naive tree builder
        const root = { children: {} }
        
        paths.forEach(path => {
            const parts = path.split('/')
            let current = root
            
            parts.forEach((part, index) => {
                if (!part) return
                
                if (!current.children[part]) {
                    const isFolder = index < parts.length - 1 || path.endsWith('/')
                    current.children[part] = {
                        name: part,
                        path: path, 
                        type: isFolder ? 'folder' : 'file',
                        children: {},
                    }
                }
                current = current.children[part]
            })
        })

        // Helper to convert dict to array
        const toArray = (node) => {
            return Object.values(node).map(n => ({
                ...n,
                children: toArray(n.children)
            })).sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name)
                return a.type === 'folder' ? -1 : 1
            })
        }
        
        fileTree.value = toArray(root.children)


        // Find .ter file
        let terFile = null
        const terFiles = []
        
        zip.forEach((relativePath, zipEntry) => {
            if (relativePath.toLowerCase().endsWith('.ter')) {
                terFiles.push(zipEntry)
            }
        })

        if (terFiles.length === 0) {
            throw new Error('No .ter file found in the zip archive.')
        }
        
        // Look for terrain config json
        let maxHeight = 600
        let sizeMeters = 2048

        let configJson = null
        zip.forEach((relativePath, zipEntry) => {
            if (relativePath.endsWith('engineTerrainBlock.json') || relativePath.endsWith('theTerrain.json')) {
                configJson = zipEntry
            }
        })

        if (configJson) {
            try {
                const txt = await configJson.async('text')
                const j = JSON.parse(txt)
                if (j.maxHeight) maxHeight = Number(j.maxHeight)
                if (j.worldSizeMeters) sizeMeters = Number(j.worldSizeMeters)
            } catch (e) {
                console.warn('Failed to parse config json', e)
            }
        }

        terFile = terFiles[0] 
        
        const buffer = await terFile.async('arraybuffer')
        const terData = parseTer(buffer)
        
        // Check if this is a MapNG generated file (Linear/Top-Left oriented)
        // or a Standard BeamNG file (Inverted/Bottom-Left oriented likely)
        const isMapNG = zip.file("mapng_metadata.json") !== null
        
        // Attach config info to terData for mesh creation
        terData.config = { maxHeight, sizeMeters, isMapNG }

        loadedLevelData.value = terData
        await createTerrainMesh(terData, zip)
        
    } catch (e) {
        throw e
    } finally {
        isLoading.value = false
    }
}


// Material/Texture map cache
const textureCache = new Map()
const materialMap = new Map() // materialName -> THREE.Material

async function downloadLevel() {
    if (!currentZip) return
    try {
        const blob = await currentZip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = loadedLevelName.value ? (loadedLevelName.value.endsWith('.zip') ? loadedLevelName.value : loadedLevelName.value + '.zip') : 'mapng_level.zip'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    } catch (e) {
        console.error('Failed to download zip', e)
        error.value = 'Failed to generate download'
    }
}

async function createTerrainMesh(terData, zip) {
  if (terrainMesh) {
    scene.remove(terrainMesh)
    if (terrainMesh.geometry) terrainMesh.geometry.dispose()
    if (terrainMesh.material) terrainMesh.material.dispose()
  }

  // --- 1. GEOMETRY SETUP ---

  const hRes = terData.size 
  const worldSize = terData.config?.sizeMeters || 2048
  // Default maxHeight to 2048 if not explicitly set (matches BeamNG defaults)
  const maxHeight = terData.config?.maxHeight != null ? terData.config.maxHeight : 2048
  const minHeight = terData.config?.minHeight || 0

  const q = quality.value
  const targetRes = q === 'low' ? 256 : q === 'medium' ? 512 : 1024
  const meshRes = Math.min(hRes, targetRes)

  const geometry = new THREE.PlaneGeometry(worldSize, worldSize, meshRes - 1, meshRes - 1)
  geometry.rotateX(-Math.PI / 2)
  
  const posAttribute = geometry.attributes.position
  const ratio = (hRes - 1) / (meshRes - 1)
  const unitsPerU16 = maxHeight / 65535

  for (let iy = 0; iy < meshRes; iy++) {
      for (let ix = 0; ix < meshRes; ix++) {
          const hx = Math.floor(ix * ratio)
          // Flip Y/Z axis reading because images/arrays are usually top-left, 3D world is bottom-left
          const z = Math.min(hRes - 1, Math.max(0, Math.floor( iy * ratio )))
          const x = Math.min(hRes - 1, Math.max(0, hx))
          
          let sourceIndex;
          if (terData.config?.isMapNG) {
             // MapNG generates Top-Left data, matching standard image iteration
             sourceIndex = Math.floor(z * hRes + x)
          } else {
             // Standard BeamNG .ter files often use Bottom-Left origin or require inversion
             // to match the Top-Down plane generation
             sourceIndex = Math.floor(((hRes - 1) - z) * hRes + x)
          }

          const rawH = terData.heightMap[sourceIndex] || 0
          
          // Calculate world height
          const worldH = minHeight + (rawH * unitsPerU16)
          
          const vIdx = iy * meshRes + ix
          // IMPORTANT: PlaneGeometry lies on X/Y. After rotateX(-90), the initial Z (normal) becomes World Y (Up).
          // The initial Y becomes World Z (Depth). 
          // So to set Height, we must modify the Y attribute of the rotated plane.
          posAttribute.setY(vIdx, worldH)
      }
  }

  geometry.computeVertexNormals()

  // --- 2. MATERIAL & TEXTURE SETUP ---
  
  // Helper to load texture from zip blob
  const loadTex = async (filename) => {
      const regex = new RegExp(filename.replace('.', '\\.') + "$", "i")
      let file = zip.file(regex)[0]
      if (!file) {
          // Manual scan if regex fails or is weird
           zip.forEach((path) => {
               if (path.endsWith(filename)) file = zip.file(path)
           })
      }
      if (!file) return null
      
      const blob = await file.async('blob')
      const url = URL.createObjectURL(blob)
      return new Promise((resolve) => {
           const tex = new THREE.TextureLoader().load(url, (t) => {
               t.colorSpace = THREE.SRGBColorSpace
               t.wrapS = THREE.RepeatWrapping
               t.wrapT = THREE.RepeatWrapping
               // Improve sharpness at angles
               if (renderer) t.anisotropy = renderer.capabilities.getMaxAnisotropy()
               resolve(t)
           }, undefined, () => resolve(null))
      })
  }

  // A. Generate Layer Map (Fallback)
  const generateLayerTexture = () => {
      const cvs = document.createElement('canvas')
      cvs.width = 1024
      cvs.height = 1024
      const ctx = cvs.getContext('2d')
      const imgData = ctx.createImageData(1024, 1024)
      const data = imgData.data
      
      const materialColors = terData.materials.map((m) => {
          let hash = 0
          for (let j = 0; j < m.length; j++) hash = m.charCodeAt(j) + ((hash << 5) - hash)
          const c = (hash & 0x00FFFFFF).toString(16).toUpperCase()
          const hex = "00000".substring(0, 6 - c.length) + c
          if (m.includes('grass')) return [50, 120, 50]
          if (m.includes('rock') || m.includes('cliff')) return [120, 120, 120]
          if (m.includes('dirt') || m.includes('mud')) return [139, 69, 19]
          if (m.includes('asphalt') || m.includes('road')) return [50, 50, 50]
          const bigInt = parseInt(hex, 16)
          return [(bigInt >> 16) & 255, (bigInt >> 8) & 255, bigInt & 255]
      })
      
      const ratio = hRes / 1024
      for (let y = 0; y < 1024; y++) {
          for (let x = 0; x < 1024; x++) {
              const lx = Math.floor(x * ratio)
              const ly = Math.floor(y * ratio)
              const layerIdx = terData.layerMap[ly * hRes + lx]
              const col = materialColors[layerIdx] || [255, 0, 255]
              const p = (y * 1024 + x) * 4
              data[p] = col[0]; data[p+1] = col[1]; data[p+2] = col[2]; data[p+3] = 255
          }
      }
      ctx.putImageData(imgData, 0, 0)
      const tex = new THREE.CanvasTexture(cvs)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
  }

  // Populate Textures
  textures.layer = generateLayerTexture()
  
  // Try finding real textures
  // Satellite / Base
  let potentialBaseMap = null
  zip.forEach((path) => {
      const lower = path.toLowerCase()
      if ((lower.includes('base') || lower.includes('macro')) && 
          (lower.endsWith('.png') || lower.endsWith('.jpg'))) {
           potentialBaseMap = path
      }
  })
  if (potentialBaseMap) {
     const t = await loadTex(potentialBaseMap)
     if (t) textures.satellite = t
  } else {
     // Default satellite to layer map if no satellite found
     textures.satellite = textures.layer
  }

  // OSM
  const osmTex = await loadTex('osm_texture.png')
  if (osmTex) {
      textures.osm = osmTex
      osmAvailable.value = true
  }

  // Hybrid
  const hybridTex = await loadTex('hybrid_texture.png')
  if (hybridTex) {
      textures.hybrid = hybridTex
      hybridAvailable.value = true
  }

  // Setup Material
  let terrainMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide,
      wireframe: showWireframe.value
  })
  
  // Decide initial texture
  if (textureType.value === 'none') {
      terrainMat.map = null
  } else {
      const t = textures[textureType.value]
      terrainMat.map = t || textures.satellite || textures.layer
  }

  terrainMesh = new THREE.Mesh(geometry, terrainMat)
  scene.add(terrainMesh)
  
  if (controls) {
    // Only reset camera on first load, check if it's way off
    // Or just let user control it.
    // Let's only reset if we just loaded new data
    // But createTerrainMesh is called on quality change too.
    // If quality change, don't reset camera.
    // How to know? Use external flag or check if 'controls.target' is default?
    // We'll skip camera reset if terrainMesh existed before (we removed it at start of fn).
    // Actually simpler: only set camera if isLoading is true (which is true during initial load logic)
    // Wait, createTerrainMesh is called at end of loadZip, where isLoading is true.
    // Using isLoading check is safe.
    
    // Oh wait, loadZip sets isLoading=true, calls createTerrainMesh, then finally sets isLoading=false.
    // So if isLoading=true here, it's a fresh load.
    // If createTerrainMesh called from watcher, isLoading is false.
    if (isLoading.value) {
        controls.target.set(0, 0, 0)
        const d = worldSize * 0.8
        camera.position.set(d, d/2, d)
        camera.lookAt(0,0,0)
        controls.update()
        // Initialize background
        updateEnvironment(preset.value)
    }
  }
}



</script>

<template>
  <div class="absolute inset-0 z-10 flex flex-row bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
    
    <!-- Viewport (Left) -->
    <div ref="canvasContainer" class="flex-1 h-full bg-gray-100 dark:bg-black relative overflow-hidden group">
       <!-- Empty State (Only if no terrain is really loaded, but we keep scene active) -->
       <div v-if="!loadedLevelData && !isLoading" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div class="text-center text-gray-400 dark:text-gray-600">
             <div class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 flex flex-col items-center bg-gray-50/50 dark:bg-gray-900/50 backdrop-blur-sm">
                 <div class="p-4 bg-gray-200 dark:bg-gray-800 rounded-full mb-4">
                    <Code :size="32" class="opacity-50" />
                 </div>
                 <p class="mb-2 font-medium text-lg text-gray-900 dark:text-white">Playground Mode</p>
                 <p class="text-sm opacity-75 mb-6">Visualizer for BeamNG terrain data</p>
                 <p class="text-xs text-gray-500">Use the panel on the right to load a level →</p>
             </div>
          </div>
       </div>

       <SceneSettingsPanel
          v-if="loadedLevelData"
          class="absolute top-4 right-4 z-20 shadow-lg max-w-xs transition-opacity duration-200"
          v-model:quality="quality"
          v-model:preset="preset"
          v-model:texture-type="textureType"
          v-model:show-wireframe="showWireframe"
          :presets="presets"
          :osm-available="osmAvailable"
          :hybrid-available="hybridAvailable"
       />
    </div>

    <!-- Sidebar (Right) -->
    <div class="w-80 flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 z-20 shadow-xl">
        <!-- Header -->
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
             <div class="flex items-center gap-3 mb-1">
                <div class="p-1.5 bg-purple-600 rounded-lg shadow-sm">
                    <Code :size="18" class="text-white" />
                </div>
                <h2 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Playground</h2>
             </div>
             <p class="text-xs text-gray-500 dark:text-gray-400">Level Inspector & Visualizer</p>
        </div>

        <!-- Actions -->
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 space-y-4">
             <div v-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle :size="14" class="mt-0.5 flex-shrink-0" />
                <span>{{ error }}</span>
             </div>

             <input 
                type="file" 
                ref="fileInput" 
                accept=".zip" 
                class="hidden" 
                @change="handleFileChange"
              />
              
              <button 
                @click="triggerFileUpload"
                :disabled="isLoading"
                class="w-full h-10 flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E65C00] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <Loader2 v-if="isLoading" :size="16" class="animate-spin" />
                <Upload v-else :size="16" />
                <span>{{ isLoading ? 'Loading Level...' : 'Upload Level Zip' }}</span>
              </button>

              <button 
                v-if="loadedLevelData"
                @click="downloadLevel"
                class="w-full h-10 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <Download :size="16" />
                <span>Download Level Zip</span>
              </button>
              
              <div v-if="loadedLevelName" class="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded border border-green-100 dark:border-green-900/30">
                  <span class="font-bold">Loaded:</span> {{ loadedLevelName }}
              </div>
        </div>

        <!-- File Tree -->
        <div class="flex-1 overflow-hidden flex flex-col">
            <div class="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                <span>File Explorer</span>
                <span v-if="fileTree.length" class="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-[10px]">{{ fileTree.length }} items</span>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar p-2">
                 <div v-if="!fileTree.length" class="h-full flex flex-col items-center justify-center text-gray-400 text-xs text-center p-8">
                    <FolderOpen :size="32" class="mb-2 opacity-20" />
                    <p>No files loaded.</p>
                 </div>
                 
                 <div v-else class="space-y-0.5">
                    <FileTreeNode v-for="node in fileTree" :key="node.path" :node="node" :depth="0" />
                 </div>
            </div>
        </div>
    </div>
  </div>
</template>
