package com.sharpeyes.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.serializerOrNull
import java.io.File

/**
 * The TypeScript for every body in shared/api, read off the serializers the server encodes with, so the
 * frontend's types cannot drift from what is sent. Plain JSON shapes: no runtime, no classes.
 */
@OptIn(ExperimentalSerializationApi::class)
internal object TypeScript {
    private const val PACKAGE = "com.sharpeyes.api."

    /** What the server decodes. A default there is the client's to leave out; anywhere else it is sent. */
    private val BEACONS = setOf("ClientErrorReport", "VitalReport")

    private fun isInbound(name: String) = name.endsWith("Request") || name in BEACONS

    /** Every serializable class compiled into this module, found on the test classpath. */
    @OptIn(InternalSerializationApi::class)
    fun roots(): List<SerialDescriptor> =
        System
            .getProperty("java.class.path")
            .split(File.pathSeparator)
            .map(::File)
            .filter { File(it, PACKAGE.replace('.', '/')).isDirectory }
            .flatMap { dir ->
                dir
                    .walk()
                    .filter { it.extension == "class" && '$' !in it.name }
                    .map {
                        it
                            .relativeTo(dir)
                            .path
                            .removeSuffix(".class")
                            .replace(File.separatorChar, '.')
                    }
            }.sorted()
            .mapNotNull {
                Class
                    .forName(it)
                    .kotlin
                    .serializerOrNull()
                    ?.descriptor
            }

    fun render(roots: List<SerialDescriptor>): String {
        val named = linkedMapOf<String, SerialDescriptor>()
        val reachedFrom = mutableMapOf<String, MutableSet<Boolean>>()

        fun visit(
            d: SerialDescriptor,
            inbound: Boolean,
        ) {
            when (d.kind) {
                StructureKind.LIST, StructureKind.MAP ->
                    (0 until d.elementsCount).forEach {
                        visit(d.getElementDescriptor(it), inbound)
                    }
                StructureKind.CLASS, SerialKind.ENUM -> {
                    if (!qualified(d).startsWith(PACKAGE)) return
                    val name = simpleName(d)
                    val seen = named.putIfAbsent(name, d)
                    require(seen == null || qualified(seen) == qualified(d)) { "two types render as $name" }
                    if (!reachedFrom.getOrPut(name) { mutableSetOf() }.add(inbound)) return
                    (0 until d.elementsCount).forEach { visit(d.getElementDescriptor(it), inbound) }
                }
                else -> Unit
            }
        }
        // A part of another body takes its direction from what contains it, not from its own name.
        val parts = roots.flatMap { referenced(it) }.toSet()
        roots.filter { simpleName(it) !in parts }.forEach { visit(it, isInbound(simpleName(it))) }
        require(roots.all { simpleName(it) in named || simpleName(it) !in parts }) { "a part no body reaches" }
        val body =
            named.keys.sorted().joinToString("\n\n") { name ->
                val d = named.getValue(name)
                if (d.kind ==
                    SerialKind.ENUM
                ) {
                    enumOf(name, d)
                } else {
                    objectOf(name, d, reachedFrom.getValue(name) == setOf(true))
                }
            }
        return HEADER + body + "\n"
    }

    /** The names of the classes and enums a body's fields name, through lists and maps. */
    private fun referenced(d: SerialDescriptor): List<String> =
        (0 until d.elementsCount).flatMap { i ->
            val e = d.getElementDescriptor(i)
            when (e.kind) {
                StructureKind.LIST, StructureKind.MAP -> referenced(e)
                StructureKind.CLASS, SerialKind.ENUM ->
                    if (qualified(
                            e,
                        ).startsWith(PACKAGE)
                    ) {
                        listOf(simpleName(e))
                    } else {
                        emptyList()
                    }
                else -> emptyList()
            }
        }

    private fun enumOf(
        name: String,
        d: SerialDescriptor,
    ) = "export type $name = " + (0 until d.elementsCount).joinToString(" | ") { "\"${d.getElementName(it)}\"" } + ";"

    private fun objectOf(
        name: String,
        d: SerialDescriptor,
        inboundOnly: Boolean,
    ): String {
        val fields =
            (0 until d.elementsCount).joinToString("") { i ->
                val cached = d.getElementAnnotations(i).any { it is AbsentOnCachedPayload }
                val optional = cached || (inboundOnly && d.isElementOptional(i))
                "  ${d.getElementName(i)}${if (optional) "?" else ""}: ${typeOf(d.getElementDescriptor(i))};\n"
            }
        return "export type $name = {\n$fields};"
    }

    private fun typeOf(d: SerialDescriptor): String {
        val type =
            when {
                qualified(d) == "kotlinx.serialization.json.JsonElement" -> "unknown"
                qualified(d) == "kotlin.uuid.Uuid" -> "string"
                d.kind == PrimitiveKind.STRING || d.kind == PrimitiveKind.CHAR -> "string"
                d.kind == PrimitiveKind.BOOLEAN -> "boolean"
                d.kind is PrimitiveKind -> "number"
                d.kind == StructureKind.LIST -> arrayOf(typeOf(d.getElementDescriptor(0)))
                d.kind == StructureKind.MAP -> "Record<${typeOf(
                    d.getElementDescriptor(0),
                )}, ${typeOf(d.getElementDescriptor(1))}>"
                d.kind is PolymorphicKind ->
                    error(
                        "${d.serialName} is polymorphic, which the generator does not render",
                    )
                else -> simpleName(d)
            }
        return if (d.isNullable) "$type | null" else type
    }

    private fun arrayOf(element: String) = if (' ' in element) "($element)[]" else "$element[]"

    /** A nullable descriptor has the underlying type's kind and elements, and its name ends in "?". */
    private fun qualified(d: SerialDescriptor) = d.serialName.removeSuffix("?")

    private fun simpleName(d: SerialDescriptor) = qualified(d).substringAfterLast('.')

    private const val HEADER =
        "// Generated from shared/api by GeneratedTypesTest. Do not edit: change the Kotlin, then run\n" +
            "// UPDATE_API_TYPES=1 ./gradlew -p shared/api jvmTest (from backend/, with backend's gradlew).\n\n"
}
