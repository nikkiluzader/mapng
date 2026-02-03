<template>
  <div class="text-xs select-none">
    <div 
       @click="toggle"
       :class="['flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded truncate transition-colors duration-100', 
                depth > 0 ? '' : '']"
       :style="{ paddingLeft: (depth * 12 + 8) + 'px' }" 
    >
      <span v-if="node.type === 'folder'" class="text-gray-400 min-w-[12px]">
         <ChevronDown v-if="isOpen" :size="12" />
         <ChevronRight v-else :size="12" />
      </span>
      <span v-else class="w-3"></span>
      
      <Folder v-if="node.type === 'folder' && !isOpen" :size="14" class="text-blue-400" />
      <FolderOpen v-else-if="node.type === 'folder' && isOpen" :size="14" class="text-blue-400" />
      <FileText v-else :size="14" class="text-gray-500" />
      
      <span :class="[node.type === 'folder' ? 'font-medium text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400']">{{ node.name }}</span>
    </div>
    
    <div v-if="node.type === 'folder' && isOpen">
       <FileTreeNode v-for="child in node.children" :key="child.path" :node="child" :depth="depth + 1" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { FileText, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  node: Object,
  depth: Number
})

const isOpen = ref(false)

const toggle = () => {
  if (props.node.type === 'folder') {
    isOpen.value = !isOpen.value
  }
}
</script>

<script>
export default {
  name: 'FileTreeNode'
}
</script>