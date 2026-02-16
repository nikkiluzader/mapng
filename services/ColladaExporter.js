/**
 * ColladaExporter - Vendored and adapted from Three.js r148
 * Original: https://github.com/gkjohnson/collada-exporter-js
 *
 * Updated to work with Three.js r162+
 *
 * Usage:
 *  const exporter = new ColladaExporter();
 *  const data = exporter.parse(scene);
 *
 * Format Definition:
 *  https://www.khronos.org/collada/
 */

import {
  Color,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
} from "three";

class ColladaExporter {
  parse(object, onDone, options = {}) {
    options = Object.assign(
      {
        version: "1.4.1",
        author: null,
        textureDirectory: "",
        upAxis: "Y_UP",
        unitName: null,
        unitMeter: null,
      },
      options
    );

    if (options.upAxis.match(/^[XYZ]_UP$/) === null) {
      console.error(
        "ColladaExporter: Invalid upAxis: valid values are X_UP, Y_UP or Z_UP."
      );
      return null;
    }

    if (options.unitName !== null && options.unitMeter === null) {
      console.error(
        "ColladaExporter: unitMeter needs to be specified if unitName is specified."
      );
      return null;
    }

    if (options.unitMeter !== null && options.unitName === null) {
      console.error(
        "ColladaExporter: unitName needs to be specified if unitMeter is specified."
      );
      return null;
    }

    if (options.textureDirectory !== "") {
      options.textureDirectory = `${options.textureDirectory}/`
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");
    }

    const version = options.version;

    if (version !== "1.4.1" && version !== "1.5.0") {
      console.warn(
        `ColladaExporter : Version ${version} not supported for export. Only 1.4.1 and 1.5.0.`
      );
      return null;
    }

    // Convert the urdf xml into a well-formatted, indented format
    function format(urdf) {
      const IS_END_TAG = /^<\//;
      const IS_SELF_CLOSING = /(\?>$)|(\/>$)/;
      const HAS_TEXT = /<[^>]+>[^<]*<\/[^<]+>/;

      const pad = (ch, num) => (num > 0 ? ch + pad(ch, num - 1) : "");

      let tagnum = 0;

      return urdf
        .match(/(<[^>]+>[^<]+<\/[^<]+>)|(<[^>]+>)/g)
        .map((tag) => {
          if (
            !HAS_TEXT.test(tag) &&
            !IS_SELF_CLOSING.test(tag) &&
            IS_END_TAG.test(tag)
          ) {
            tagnum--;
          }

          const res = `${pad("  ", tagnum)}${tag}`;

          if (
            !HAS_TEXT.test(tag) &&
            !IS_SELF_CLOSING.test(tag) &&
            !IS_END_TAG.test(tag)
          ) {
            tagnum++;
          }

          return res;
        })
        .join("\n");
    }

    // Convert an image into a png format for saving
    function base64ToBuffer(str) {
      const b = atob(str);
      const buf = new Uint8Array(b.length);

      for (let i = 0, l = buf.length; i < l; i++) {
        buf[i] = b.charCodeAt(i);
      }

      return buf;
    }

    let canvas, ctx;

    function imageToData(image, ext) {
      if (
        (typeof HTMLImageElement !== "undefined" &&
          image instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== "undefined" &&
          image instanceof HTMLCanvasElement) ||
        (typeof OffscreenCanvas !== "undefined" &&
          image instanceof OffscreenCanvas) ||
        (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
      ) {
        canvas = canvas || document.createElement("canvas");
        ctx = ctx || canvas.getContext("2d");

        canvas.width = image.width;
        canvas.height = image.height;

        ctx.drawImage(image, 0, 0);

        // Get the base64 encoded data
        const base64data = canvas
          .toDataURL(`image/${ext}`, 1)
          .replace(/^data:image\/(png|jpg);base64,/, "");

        // Convert to a uint8 array
        return base64ToBuffer(base64data);
      } else {
        throw new Error(
          "ColladaExporter: No valid image data found. Unable to process texture."
        );
      }
    }

    // gets the attribute array. Generate a new array if the attribute is interleaved
    const getFuncs = ["getX", "getY", "getZ", "getW"];
    const tempColor = new Color();

    function attrBufferToArray(attr, isColor = false) {
      if (isColor) {
        // convert the colors to srgb before export
        // colors are always written as floats
        const arr = new Float32Array(attr.count * 3);
        for (let i = 0, l = attr.count; i < l; i++) {
          tempColor.fromBufferAttribute(attr, i).convertLinearToSRGB();

          arr[3 * i + 0] = tempColor.r;
          arr[3 * i + 1] = tempColor.g;
          arr[3 * i + 2] = tempColor.b;
        }

        return arr;
      } else if (attr.isInterleavedBufferAttribute) {
        // use the typed array constructor to save on memory
        const arr = new attr.array.constructor(attr.count * attr.itemSize);
        const size = attr.itemSize;

        for (let i = 0, l = attr.count; i < l; i++) {
          for (let j = 0; j < size; j++) {
            arr[i * size + j] = attr[getFuncs[j]](i);
          }
        }

        return arr;
      } else {
        return attr.array;
      }
    }

    // Returns an array of the same type starting at the `st` index,
    // and `ct` length
    function subArray(arr, st, ct) {
      if (Array.isArray(arr)) return arr.slice(st, st + ct);
      else
        return new arr.constructor(arr.buffer, st * arr.BYTES_PER_ELEMENT, ct);
    }

    // Returns the string parts for a geometry's attribute as an array
    // to avoid creating one giant string that overflows allocation limits
    function getAttributeParts(attr, name, params, type, isColor = false) {
      const array = attrBufferToArray(attr, isColor);
      const parts = [];
      parts.push(
        `<source id="${name}">` +
        `<float_array id="${name}-array" count="${array.length}">`
      );

      // Write float data in chunks to avoid allocation overflow
      const CHUNK = 65536;
      for (let i = 0; i < array.length; i += CHUNK) {
        if (i > 0) parts.push(' ');
        const end = Math.min(i + CHUNK, array.length);
        const slice = Array.prototype.slice.call(array, i, end);
        parts.push(slice.join(' '));
      }

      parts.push(
        '</float_array>' +
        '<technique_common>' +
        `<accessor source="#${name}-array" count="${Math.floor(
          array.length / attr.itemSize
        )}" stride="${attr.itemSize}">` +
        params.map((n) => `<param name="${n}" type="${type}" />`).join('') +
        '</accessor>' +
        '</technique_common>' +
        '</source>'
      );

      return parts;
    }

    // Returns the string for a node's transform information
    let transMat;
    function getTransform(o) {
      // ensure the object's matrix is up to date
      // before saving the transform
      o.updateMatrix();

      transMat = transMat || new Matrix4();
      transMat.copy(o.matrix);
      transMat.transpose();
      return `<matrix>${transMat.toArray().join(" ")}</matrix>`;
    }

    // Process the given piece of geometry into the geometry library
    // Returns the mesh id
    function processGeometry(bufferGeometry) {
      let info = geometryInfo.get(bufferGeometry);

      if (!info) {
        const meshid = `Mesh${libraryGeometries.length + 1}`;

        const indexCount = bufferGeometry.index
          ? bufferGeometry.index.count * bufferGeometry.index.itemSize
          : bufferGeometry.attributes.position.count;

        const groups =
          bufferGeometry.groups != null && bufferGeometry.groups.length !== 0
            ? bufferGeometry.groups
            : [{ start: 0, count: indexCount, materialIndex: 0 }];

        const gname = bufferGeometry.name
          ? ` name="${bufferGeometry.name}"`
          : "";

        // Use array of parts to avoid building one giant string
        const gparts = [];
        gparts.push(`<geometry id="${meshid}"${gname}><mesh>`);

        // define the geometry node and the vertices for the geometry
        const posName = `${meshid}-position`;
        const vertName = `${meshid}-vertices`;
        gparts.push(...getAttributeParts(
          bufferGeometry.attributes.position,
          posName,
          ["X", "Y", "Z"],
          "float"
        ));
        gparts.push(`<vertices id="${vertName}"><input semantic="POSITION" source="#${posName}" /></vertices>`);

        // serialize normals
        let triangleInputs = `<input semantic="VERTEX" source="#${vertName}" offset="0" />`;
        if ("normal" in bufferGeometry.attributes) {
          const normName = `${meshid}-normal`;
          gparts.push(...getAttributeParts(
            bufferGeometry.attributes.normal,
            normName,
            ["X", "Y", "Z"],
            "float"
          ));
          triangleInputs += `<input semantic="NORMAL" source="#${normName}" offset="0" />`;
        }

        // serialize uvs
        if ("uv" in bufferGeometry.attributes) {
          const uvName = `${meshid}-texcoord`;
          gparts.push(...getAttributeParts(
            bufferGeometry.attributes.uv,
            uvName,
            ["S", "T"],
            "float"
          ));
          triangleInputs += `<input semantic="TEXCOORD" source="#${uvName}" offset="0" set="0" />`;
        }

        // serialize lightmap uvs — support both old 'uv2' and new 'uv1' naming
        const uv2Key =
          "uv2" in bufferGeometry.attributes
            ? "uv2"
            : "uv1" in bufferGeometry.attributes
            ? "uv1"
            : null;
        if (uv2Key) {
          const uvName = `${meshid}-texcoord2`;
          gparts.push(...getAttributeParts(
            bufferGeometry.attributes[uv2Key],
            uvName,
            ["S", "T"],
            "float"
          ));
          triangleInputs += `<input semantic="TEXCOORD" source="#${uvName}" offset="0" set="1" />`;
        }

        // serialize colors
        if ("color" in bufferGeometry.attributes) {
          const colName = `${meshid}-color`;
          gparts.push(...getAttributeParts(
            bufferGeometry.attributes.color,
            colName,
            ["R", "G", "B"],
            "float",
            true
          ));
          triangleInputs += `<input semantic="COLOR" source="#${colName}" offset="0" />`;
        }

        let indexArray = null;
        if (bufferGeometry.index) {
          indexArray = attrBufferToArray(bufferGeometry.index);
        } else {
          indexArray = new Array(indexCount);
          for (let i = 0, l = indexArray.length; i < l; i++) indexArray[i] = i;
        }

        for (let i = 0, l = groups.length; i < l; i++) {
          const group = groups[i];
          const subarr = subArray(indexArray, group.start, group.count);
          const polycount = subarr.length / 3;
          gparts.push(`<triangles material="MESH_MATERIAL_${group.materialIndex}" count="${polycount}">`);
          gparts.push(triangleInputs);

          // Chunk index array too for large meshes
          gparts.push('<p>');
          const ICHUNK = 65536;
          for (let j = 0; j < subarr.length; j += ICHUNK) {
            if (j > 0) gparts.push(' ');
            const end = Math.min(j + ICHUNK, subarr.length);
            const slice = Array.prototype.slice.call(subarr, j, end);
            gparts.push(slice.join(' '));
          }
          gparts.push('</p>');
          gparts.push('</triangles>');
        }

        gparts.push('</mesh></geometry>');

        libraryGeometries.push(gparts);

        info = { meshid: meshid, bufferGeometry: bufferGeometry };
        geometryInfo.set(bufferGeometry, info);
      }

      return info;
    }

    // Process the given texture into the image library
    // Returns the image library
    function processTexture(tex) {
      let texid = imageMap.get(tex);

      if (texid === undefined) {
        texid = `image-${libraryImages.length + 1}`;

        const ext = "png";
        const name = tex.name || texid;
        let imageNode = `<image id="${texid}" name="${name}">`;

        if (version === "1.5.0") {
          imageNode += `<init_from><ref>${options.textureDirectory}${name}.${ext}</ref></init_from>`;
        } else {
          // version image node 1.4.1
          imageNode += `<init_from>${options.textureDirectory}${name}.${ext}</init_from>`;
        }

        imageNode += "</image>";

        libraryImages.push(imageNode);
        imageMap.set(tex, texid);
        textures.push({
          directory: options.textureDirectory,
          name,
          ext,
          data: imageToData(tex.image, ext),
          original: tex,
        });
      }

      return texid;
    }

    // Process the given material into the material and effect libraries
    // Returns the material id
    function processMaterial(m) {
      let matid = materialMap.get(m);

      if (matid == null) {
        matid = `Mat${libraryEffects.length + 1}`;

        let type = "phong";

        if (m.isMeshLambertMaterial === true) {
          type = "lambert";
        } else if (m.isMeshBasicMaterial === true) {
          type = "constant";

          if (m.map !== null) {
            // The Collada spec does not support diffuse texture maps with the
            // constant shader type.
            // mrdoob/three.js#15469
            console.warn(
              "ColladaExporter: Texture maps not supported with MeshBasicMaterial."
            );
          }
        }

        const emissive = m.emissive ? m.emissive.clone() : new Color(0, 0, 0);
        const diffuse = m.color ? m.color.clone() : new Color(0, 0, 0);
        const specular = m.specular ? m.specular.clone() : new Color(1, 1, 1);
        const shininess = m.shininess || 0;
        const reflectivity = m.reflectivity || 0;

        emissive.convertLinearToSRGB();
        specular.convertLinearToSRGB();
        diffuse.convertLinearToSRGB();

        // Do not export an alpha map for the reasons mentioned in issue (#13792)
        // in three.js alpha maps are black and white, but collada expects the alpha
        // channel to specify the transparency
        let transparencyNode = "";
        if (m.transparent === true) {
          transparencyNode +=
            "<transparent>" +
            (m.map
              ? '<texture texture="diffuse-sampler"></texture>'
              : "<float>1</float>") +
            "</transparent>";

          if (m.opacity < 1) {
            transparencyNode += `<transparency><float>${m.opacity}</float></transparency>`;
          }
        }

        const techniqueNode =
          `<technique sid="common"><${type}>` +
          "<emission>" +
          (m.emissiveMap
            ? '<texture texture="emissive-sampler" texcoord="TEXCOORD" />'
            : `<color sid="emission">${emissive.r} ${emissive.g} ${emissive.b} 1</color>`) +
          "</emission>" +
          (type !== "constant"
            ? "<diffuse>" +
              (m.map
                ? '<texture texture="diffuse-sampler" texcoord="TEXCOORD" />'
                : `<color sid="diffuse">${diffuse.r} ${diffuse.g} ${diffuse.b} 1</color>`) +
              "</diffuse>"
            : "") +
          (type !== "constant"
            ? "<bump>" +
              (m.normalMap
                ? '<texture texture="bump-sampler" texcoord="TEXCOORD" />'
                : "") +
              "</bump>"
            : "") +
          (type === "phong"
            ? `<specular><color sid="specular">${specular.r} ${specular.g} ${specular.b} 1</color></specular>` +
              "<shininess>" +
              (m.specularMap
                ? '<texture texture="specular-sampler" texcoord="TEXCOORD" />'
                : `<float sid="shininess">${shininess}</float>`) +
              "</shininess>"
            : "") +
          `<reflective><color>${diffuse.r} ${diffuse.g} ${diffuse.b} 1</color></reflective>` +
          `<reflectivity><float>${reflectivity}</float></reflectivity>` +
          transparencyNode +
          `</${type}></technique>`;

        const effectnode =
          `<effect id="${matid}-effect">` +
          "<profile_COMMON>" +
          (m.map
            ? '<newparam sid="diffuse-surface"><surface type="2D">' +
              `<init_from>${processTexture(m.map)}</init_from>` +
              "</surface></newparam>" +
              '<newparam sid="diffuse-sampler"><sampler2D><source>diffuse-surface</source></sampler2D></newparam>'
            : "") +
          (m.specularMap
            ? '<newparam sid="specular-surface"><surface type="2D">' +
              `<init_from>${processTexture(m.specularMap)}</init_from>` +
              "</surface></newparam>" +
              '<newparam sid="specular-sampler"><sampler2D><source>specular-surface</source></sampler2D></newparam>'
            : "") +
          (m.emissiveMap
            ? '<newparam sid="emissive-surface"><surface type="2D">' +
              `<init_from>${processTexture(m.emissiveMap)}</init_from>` +
              "</surface></newparam>" +
              '<newparam sid="emissive-sampler"><sampler2D><source>emissive-surface</source></sampler2D></newparam>'
            : "") +
          (m.normalMap
            ? '<newparam sid="bump-surface"><surface type="2D">' +
              `<init_from>${processTexture(m.normalMap)}</init_from>` +
              "</surface></newparam>" +
              '<newparam sid="bump-sampler"><sampler2D><source>bump-surface</source></sampler2D></newparam>'
            : "") +
          techniqueNode +
          (m.side === DoubleSide
            ? '<extra><technique profile="THREEJS"><double_sided sid="double_sided" type="int">1</double_sided></technique></extra>'
            : "") +
          "</profile_COMMON>" +
          "</effect>";

        const materialName = m.name ? ` name="${m.name}"` : "";
        const materialNode = `<material id="${matid}"${materialName}><instance_effect url="#${matid}-effect" /></material>`;

        libraryMaterials.push(materialNode);
        libraryEffects.push(effectnode);
        materialMap.set(m, matid);
      }

      return matid;
    }

    // Recursively process the object into a scene
    function processObject(o) {
      let node = `<node name="${o.name}">`;

      node += getTransform(o);

      if (o.isMesh === true && o.geometry !== null) {
        // function returns the id associated with the mesh and a "BufferGeometry" version
        // of the geometry in case it's not a geometry.
        const geomInfo = processGeometry(o.geometry);
        const meshid = geomInfo.meshid;
        const geometry = geomInfo.bufferGeometry;

        // ids of the materials to bind to the geometry
        let matids = null;
        let matidsArray;

        // get a list of materials to bind to the sub groups of the geometry.
        // If the amount of subgroups is greater than the materials, then reuse
        // the materials.
        const mat = o.material || new MeshBasicMaterial();
        const materials = Array.isArray(mat) ? mat : [mat];

        if (geometry.groups.length > materials.length) {
          matidsArray = new Array(geometry.groups.length);
        } else {
          matidsArray = new Array(materials.length);
        }

        matids = matidsArray
          .fill()
          .map((v, i) => processMaterial(materials[i % materials.length]));

        node +=
          `<instance_geometry url="#${meshid}">` +
          (matids.length > 0
            ? "<bind_material><technique_common>" +
              matids
                .map(
                  (id, i) =>
                    `<instance_material symbol="MESH_MATERIAL_${i}" target="#${id}" >` +
                    '<bind_vertex_input semantic="TEXCOORD" input_semantic="TEXCOORD" input_set="0" />' +
                    "</instance_material>"
                )
                .join("") +
              "</technique_common></bind_material>"
            : "") +
          "</instance_geometry>";
      }

      o.children.forEach((c) => (node += processObject(c)));

      node += "</node>";

      return node;
    }

    const geometryInfo = new WeakMap();
    const materialMap = new WeakMap();
    const imageMap = new WeakMap();
    const textures = [];

    const libraryImages = [];
    const libraryGeometries = [];
    const libraryEffects = [];
    const libraryMaterials = [];
    const libraryVisualScenes = processObject(object);

    const specLink =
      version === "1.4.1"
        ? "http://www.collada.org/2005/11/COLLADASchema"
        : "https://www.khronos.org/collada/";

    // Build DAE as array of string parts to avoid allocation overflow
    // on large scenes. No pretty-printing (format) is applied to keep
    // memory bounded.
    const daeParts = [];
    daeParts.push(
      '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>' +
      `<COLLADA xmlns="${specLink}" version="${version}">` +
      "<asset>" +
      "<contributor>" +
      "<authoring_tool>three.js Collada Exporter</authoring_tool>" +
      (options.author !== null
        ? `<author>${options.author}</author>`
        : "") +
      "</contributor>" +
      `<created>${new Date().toISOString()}</created>` +
      `<modified>${new Date().toISOString()}</modified>` +
      (options.unitName !== null
        ? `<unit name="${options.unitName}" meter="${options.unitMeter}" />`
        : "") +
      `<up_axis>${options.upAxis}</up_axis>` +
      "</asset>"
    );

    daeParts.push(`<library_images>${libraryImages.join("")}</library_images>`);

    daeParts.push(`<library_effects>${libraryEffects.join("")}</library_effects>`);

    daeParts.push(`<library_materials>${libraryMaterials.join("")}</library_materials>`);

    // Geometry library: each entry is an array of parts, flatten them
    daeParts.push('<library_geometries>');
    for (const geoParts of libraryGeometries) {
      for (const part of geoParts) {
        daeParts.push(part);
      }
    }
    daeParts.push('</library_geometries>');

    daeParts.push(`<library_visual_scenes><visual_scene id="Scene" name="scene">${libraryVisualScenes}</visual_scene></library_visual_scenes>`);

    daeParts.push('<scene><instance_visual_scene url="#Scene"/></scene>');

    daeParts.push("</COLLADA>");

    const res = {
      data: new Blob(daeParts, { type: 'model/vnd.collada+xml' }),
      textures,
    };

    if (typeof onDone === "function") {
      requestAnimationFrame(() => onDone(res));
    }

    return res;
  }
}

export { ColladaExporter };
