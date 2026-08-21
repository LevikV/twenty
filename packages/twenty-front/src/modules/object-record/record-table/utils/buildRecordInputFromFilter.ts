import { type CurrentWorkspaceMember } from '@/auth/states/currentWorkspaceMemberState';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { isCompositeFieldType } from '@/object-record/object-filter-dropdown/utils/isCompositeFieldType';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { buildValueFromFilter } from '@/object-record/record-table/utils/buildValueFromFilter';
import { type ObjectRecord } from 'twenty-shared/types';
import {
  computeMorphRelationGqlFieldName,
  computeRelationGqlFieldJoinColumnName,
  deepMerge,
  isDefined,
} from 'twenty-shared/utils';

export const buildRecordInputFromFilter = ({
  currentRecordFilters,
  objectMetadataItem,
  currentWorkspaceMember,
  currentRecordId,
  currentRecordObjectNameSingular,
  timeZone,
}: {
  currentRecordFilters: RecordFilter[];
  objectMetadataItem: EnrichedObjectMetadataItem;
  currentWorkspaceMember?: CurrentWorkspaceMember;
  currentRecordId?: string;
  currentRecordObjectNameSingular?: string;
  timeZone: string;
}): Partial<ObjectRecord> => {
  const recordInput: Partial<ObjectRecord> = {};

  currentRecordFilters.forEach((filter) => {
    const fieldMetadataItem = objectMetadataItem.fields.find(
      (field) => field.id === filter.fieldMetadataId,
    );

    if (!isDefined(fieldMetadataItem)) {
      return;
    }

    // A relation-traversal filter constrains a field of the related record,
    // not a column of the record being created, so it cannot be prefilled.
    if (isDefined(filter.relationTargetFieldMetadataId)) {
      return;
    }

    if (fieldMetadataItem.type === 'RELATION') {
      const value = buildValueFromFilter({
        filter,
        options: fieldMetadataItem.options ?? undefined,
        relationType: fieldMetadataItem.relation?.type,
        currentWorkspaceMember: currentWorkspaceMember ?? undefined,
        currentRecordId,
        label: filter.label,
        timeZone,
      });

      if (!isDefined(value)) {
        return;
      }

      recordInput[
        computeRelationGqlFieldJoinColumnName({ name: fieldMetadataItem.name })
      ] = value;
    } else if (fieldMetadataItem.type === 'MORPH_RELATION') {
      // A morph filter's join column depends on the target object of the
      // current record (e.g. otnositsyaK -> otnositsyaKTenderId on a tender
      // page), so resolve the matching morph relation first.
      const matchingMorphRelation = fieldMetadataItem.morphRelations?.find(
        (morphRelation) =>
          morphRelation.targetObjectMetadata.nameSingular ===
          currentRecordObjectNameSingular,
      );

      if (!isDefined(matchingMorphRelation)) {
        return;
      }

      const value = buildValueFromFilter({
        filter,
        options: fieldMetadataItem.options ?? undefined,
        relationType: matchingMorphRelation.type,
        currentWorkspaceMember: currentWorkspaceMember ?? undefined,
        currentRecordId,
        label: filter.label,
        timeZone,
      });

      if (!isDefined(value)) {
        return;
      }

      const morphGqlFieldName = computeMorphRelationGqlFieldName({
        fieldName: fieldMetadataItem.name,
        relationType: matchingMorphRelation.type,
        targetObjectMetadataNameSingular:
          matchingMorphRelation.targetObjectMetadata.nameSingular,
        targetObjectMetadataNamePlural:
          matchingMorphRelation.targetObjectMetadata.namePlural,
      });

      recordInput[
        computeRelationGqlFieldJoinColumnName({ name: morphGqlFieldName })
      ] = value;
    } else {
      const value = buildValueFromFilter({
        filter,
        options: fieldMetadataItem.options ?? undefined,
        timeZone,
      });

      if (!isDefined(value)) {
        return;
      }

      if (isCompositeFieldType(fieldMetadataItem.type)) {
        recordInput[fieldMetadataItem.name] = deepMerge(
          recordInput[fieldMetadataItem.name] ?? {},
          value,
        );
      } else {
        recordInput[fieldMetadataItem.name] = value;
      }
    }
  });

  return recordInput;
};
